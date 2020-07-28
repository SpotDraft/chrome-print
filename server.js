const express = require("express");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const fs = require("fs-extra");
const makeDir = require("make-dir");
const path = require("path");
const tempy = require("tempy");
const CDP = require("chrome-remote-interface");
const URL = require("url");
const IPCIDR = require("ip-cidr");
const Address4 = require("ip-address").Address4;
const dns = require("dns");

const PRIVATE_IP_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.1/32", // loopback
  "169.254.169.254/32", // aws metadata server
];

const cdpHost = process.env.CHROME_HEADLESS_PORT_9222_TCP_ADDR || "localhost";
const cdpPort = process.env.CHROME_HEADLESS_PORT_9222_TCP_PORT || "9222";

function print({
  url,
  format = "png",
  width = 8.5,
  height = 11,
  delay = 300,
  marginBottom = 0,
  marginLeft = 0,
  marginRight = 0,
  marginTop = 0,
  userAgent = null,
  full = false
}) {
  return new Promise((resolve, reject) => {
    // Start the Chrome Debugging Protocol
    CDP.New({ host: cdpHost, port: cdpPort })
      .then(target => CDP({ target, host: cdpHost, port: cdpPort }))
      .then(client => {
        // Extract used DevTools domains.
        const { DOM, Emulation, Network, Page, Runtime } = client;

        // Set up viewport resolution, etc.
        const deviceMetrics = {
          width,
          height,
          deviceScaleFactor: 0,
          mobile: false,
          fitWindow: false,
        };

        // Enable events on domains we are interested in.
        Promise.all([
          Page.enable(),
          DOM.enable(),
          Network.enable(),
        ]).then(() => {
          Network.setRequestInterceptionEnabled({ enabled: true })
        }).then(() => {
          Network.requestIntercepted(data => {
            const interceptionId = data.interceptionId;
            const request = data.request;

            const parsedUrl = URL.parse(request.url);

            // set to true if a ip requested is an internal IP.
            let internalIp = false;
            internalIp = isInternalIp(parsedUrl.hostname);
            console.log(`IsInternalIP ${parsedUrl.hostname} = ${internalIp}`)

            // set to true if a host being requested is a cluster local host.
            let internalHost = false;

            // if the requested url is file it is blocked outside this method.
            // but we might generate a local url so allow that.
            const fileUrl = request.url.indexOf("file://") >= 0 && request.url !== url;
            function continueRequestMaybe() {
              if (fileUrl || internalIp || internalHost) {
                console.log("Blocking URL: " + request.url + " as it is not safe!");
                console.log("Reason for blocking: " + request.url + " " + fileUrl + " " + internalIp + " " + internalHost);
                Network.continueInterceptedRequest({
                  interceptionId,
                  errorReason: "Aborted"
                });
              } else {
                Network.continueInterceptedRequest({
                  interceptionId,
                });
              }
            }

            if (parsedUrl.protocol === "file:") {
              continueRequestMaybe();
              return;
            }

            // cluster local domains might not have a "."
            if (
              parsedUrl.hostname.indexOf(".") <= 0 ||
              parsedUrl.hostname.endsWith(".internal") ||
              parsedUrl.hostname.endsWith("cluster.local")
            ) {
              internalHost = true;
              continueRequestMaybe();
            } else {
              // try to resolve hostname and check if IP is internal
              dns.resolve4(parsedUrl.hostname, (err, addresses) => {
                if (err) {
                  continueRequestMaybe();
                  return;
                }

                if (isInternalIp(addresses[0])) {
                  internalHost = true;
                }
                continueRequestMaybe();
              });
            }
          })
        }).then(() => Emulation.setDeviceMetricsOverride(deviceMetrics)
        ).then(() => Emulation.setVisibleSize({ width, height })
        ).then(() => Page.navigate({ url })).catch((e) => reject(e));


        // Wait for page load event to take screenshot
        Page.loadEventFired(() => {
          setTimeout(() => {
            Page.printToPDF({
              paperWidth: width,
              paperHeight: height,

              scale: 1,
              // landscape: false,
              displayHeaderFooter: false,
              printBackground: true,
              marginTop,
              marginBottom,
              marginLeft,
              marginRight,
            }).then((screenshot) => {
              const buffer = new Buffer(screenshot.data, "base64");
              client.close();
              CDP.Close({ id: client.target.id, host: cdpHost, port: cdpPort })
                .then(() => resolve(buffer))
                .catch(e => reject(e));
            })
              .catch(e => reject(e));

            // Wait for page load event to take screenshot
            Page.loadEventFired(() => {
              setTimeout(() => {
                Page.printToPDF({
                  paperWidth: width,
                  paperHeight: height,

                  scale: 1,
                  // landscape: false,
                  displayHeaderFooter: false,
                  printBackground: true,
                  marginTop,
                  marginBottom,
                  marginLeft,
                  marginRight
                })
                  .then(screenshot => {
                    const buffer = new Buffer(screenshot.data, "base64");
                    client.close();
                    CDP.Close({
                      id: client.target.id,
                      host: cdpHost,
                      port: cdpPort
                    })
                      .then(() => resolve(buffer))
                      .catch(e => reject(e));
                  })
                  .catch(e => reject(e));
              }, delay);
            });
          })
            
        }).catch(err => {
          reject(err);
        });
      });
  });
}

const app = express();
// bodyParser = {
//   json: { limit: "50mb", extended: true },
//   urlencoded: { limit: "50mb", extended: true }
// };

app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb", extended: true }));
app.use(fileUpload());

app.get("/", (req, res) => {
  res.type("text/plain").send(`Here's a nice curl example of the api:
curl -F "htmlFile=@test.html" -F "width=8.5" -F "height=11" -X POST -H "Content-Type: multipart/form-data" -o result.pdf http://thisurl/

OR

curl -F "url=http://www.google.com" -F "width=8.5" -F "height=11" -X POST -H "Content-Type: multipart/form-data" -o result.pdf http://thisurl/
    `);
});

app.post("/", (req, res) => {
  const file = req.files && req.files.htmlFile;
  const bodyFile = req.body && req.body.htmlFile;
  const getIntOrUndefined = name =>
    req.body[name] ? parseInt(req.body[name], 10) : undefined;
  const width = getIntOrUndefined("width");
  const height = getIntOrUndefined("height");
  const delay = getIntOrUndefined("delay");
  const marginBottom = getIntOrUndefined("marginBottom");
  const marginLeft = getIntOrUndefined("marginLeft");
  const marginRight = getIntOrUndefined("marginRight");
  const marginTop = getIntOrUndefined("marginTop");

  let url = req.body.url;
  let newPath;

  function runPrint() {
    console.log(`Printing ${url} with args:
w=${width} h=${height} delay=${delay}
margins: t=${marginTop} r=${marginRight} b=${marginBottom} l=${marginLeft}`);
    print({
      width,
      height,
      delay,
      url,
      marginBottom,
      marginLeft,
      marginRight,
      marginTop
    })
      .then(data => {
        console.log(`SUCCESS Printing ${url}`);
        res
          .status(200)
          .type("application/pdf")
          .send(data);
        if (newPath) {
          fs.remove(newPath);
        }
      })
      .catch(e => {
        console.log(`ERROR Printing ${url}`);
        console.log(e);
        res.status(500).send("some kind of failure");
      });
  }

  if (!file && !url && !bodyFile) {
    console.log(`URL / FILE not specified`);
    return res
      .status(422)
      .send("No htmlFile or url sent. One of them is required!");
  }

  if (file) {
    console.log(`FILE specified`);
    const tmp = tempy.file({ extension: "html" });

    file.mv(tmp, err => {
      if (err) {
        res.status(500).send("There was an error.");
        throw err;
      }

      newPath = `/printfiles/${tmp.replace(/^.*\/(.*)$/, "$1")}`;
      fs.move(tmp, newPath, { overwrite: true }, err => {
        if (err) {
          console.log(err);
          res.status(500).send("There was an error.");
          return;
        }
        url = "file://" + newPath;

        runPrint();
      });
    });
  } else if (bodyFile) {
    console.log(`file specified in JSON Body`);
    const newFile = tempy.file({ extension: "html" });
    const newPath = `/printfiles/${newFile.replace(/^.*\/(.*)$/, "$1")}`;

    makeDir.sync(path.dirname(newPath));
    fs.writeFileSync(newPath, bodyFile);

    url = "file://" + newPath;

    runPrint();
  } else {
    console.log(`URL specified ${url}`);
    if (url.indexOf("file://") >= 0) {
      res.status(422).send("File URL detected");
      return;
    }
    runPrint();
  }
});

app.listen(process.env.NODE_PORT || 8888, function () {
  console.log("listening to +++", 8888);
});

/** Checks if the IP falls in an Internal CIDR range. */
function isInternalIp(hostname) {
  let parsedIp;
  try {
    parsedIp = new Address4(hostname);
  } catch (e) {
    return false;
  }

  if (parsedIp.isValid()) {
    for (let i = 0; i < PRIVATE_IP_RANGES.length; i++) {
      const cird = new IPCIDR(PRIVATE_IP_RANGES[i]);
      if (cird.contains(parsedIp)) {
        return true;
      }
    };
  }
  return false;
}

