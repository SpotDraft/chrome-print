const express = require('express');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const fs = require('fs-extra');
const tempy = require('tempy');
const CDP = require('chrome-remote-interface');

const cdpHost = process.env.CHROME_HEADLESS_PORT_9222_TCP_ADDR || 'localhost';
const cdpPort = process.env.CHROME_HEADLESS_PORT_9222_TCP_PORT || '9222';

function print({
  url,
  format = 'png',
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
    CDP.New({host: cdpHost, port: cdpPort})
      .then(target => CDP({target, host: cdpHost, port: cdpPort}))
      .then(client => {


      // Extract used DevTools domains.
      const {DOM, Emulation, Network, Page, Runtime} = client;

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
        Emulation.setDeviceMetricsOverride(deviceMetrics).then(() => {
          Emulation.setVisibleSize({width, height}).then(() => {
            // Navigate to target page
            Page.navigate({url}).then(() => {
            });
          });
        }).catch((e) => reject(e));
      }).catch((e) => reject(e));


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
            const buffer = new Buffer(screenshot.data, 'base64');
            client.close();
            CDP.Close({id: client.target.id, host: cdpHost, port: cdpPort})
              .then(() => resolve(buffer))
              .catch(e => reject(e));
          }).catch((e) => reject(e));
        }, delay);
      });
    }).catch(err => {
      reject(err);
    });

  });
}

const app = express();

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(fileUpload());

app.get('/', (req, res) => {
  res.type('text/plain').send(`Here's a nice curl example of the api:
curl -F "htmlFile=@test.html" -F "width=8.5" -F "height=11" -X POST -H "Content-Type: multipart/form-data" -o result.pdf http://thisurl/

OR

curl -F "url=http://www.google.com" -F "width=8.5" -F "height=11" -X POST -H "Content-Type: multipart/form-data" -o result.pdf http://thisurl/
    `);
});

app.post('/', (req, res) => {
  const file = (req.files && req.files.htmlFile);
  const getIntOrUndefined = (name) => req.body[name] ? parseInt(req.body[name], 10) : undefined;
  const width = getIntOrUndefined('width');
  const height = getIntOrUndefined('height');
  const delay = getIntOrUndefined('delay');
  const marginBottom = getIntOrUndefined('marginBottom');
  const marginLeft = getIntOrUndefined('marginLeft');
  const marginRight = getIntOrUndefined('marginRight');
  const marginTop = getIntOrUndefined('marginTop');
  
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
    }).then((data) => {
      console.log(`SUCCESS Printing ${url}`);
      res.status(200).type('application/pdf').send(data);
      if (newPath) {
        fs.remove(newPath);
      }
    }).catch((e) => {
      console.log(`ERROR Printing ${url}`);
      console.log(e);
      res.status(500).send('some kind of failure');
    });
  }
  
  if (req.body && req.body.htmlFile) {
    console.log(`file specified in JSON Body`);
    file = tempy.file({extension: 'html'});
    
    fs.writeFileSync(file, req.body.htmlFile);
  }

  if (!file && !url) {
    console.log(`URL / FILE not specified`);
    return res.status(422).send('No htmlFile or url sent. One of them is required!');
  }

  if (file) {
    console.log(`FILE specified`);
    const tmp = tempy.file({extension: 'html'});
    
    file.mv(tmp, (err) => {
      if (err) {
        res.status(500).send('There was an error.');
        throw err;
      }

      newPath = `/printfiles/${tmp.replace(/^.*\/(.*)$/, '$1')}`;
      fs.move(tmp, newPath, {overwrite: true}, err => {
        if (err) {
          console.log(err);
          res.status(500).send('There was an error.');
        }
        url = 'file://' + newPath;

        runPrint();

      });
    })
  } else {
    console.log(`URL specified ${url}`);
    runPrint();
  }
  
});

app.listen(process.env.NODE_PORT || 8888);
