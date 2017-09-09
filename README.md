# chrome-print

A headless chrome process with an express-based API in front of it. Upload an
HTML file, specify width and height, get a PDF back.

## Run

```bash
docker-compose up
```

## Usage

```bash
# get the port the server is listening on
port=`docker ps |grep chromeprint_print |sed 's/.*:\([0-9]*\)-.*/\1/'`

# send the request
curl \
  -F "htmlFile=@test.html" \
  -F "width=8.5" \
  -F "height=11" \
  -X POST \
  -H "Content-Type: multipart/form-data" \
  -o test.pdf \
  http://localhost:$port/

# OR Send a URL

curl \
  -F "url=https://www.google.com/" \
  -F "width=8.5" \
  -F "height=11" \
  -X POST \
  -H "Content-Type: multipart/form-data" \
  -o test.pdf \
  http://localhost:$port/
```

## Options

See also https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF

| Name of param  | Default Value | Description                                                |
|----------------|---------------|------------------------------------------------------------|
| `htmlFile`     | `undefined`   | One of `htmlFile` or `url` is required.                    |
| `url`          | `undefined`   | One of `htmlFile` or `url` is required.                    |
| `width`        | `8.5`         | Width of page in inches                                    |
| `height`       | `11`          | Height of page in inches                                   |
| `delay`        | `undefined`   | Delay in milliseconds to wait for JS/AJAX after page load. |
| `marginBottom` | `0`           | Page bottom margin in inches                               |
| `marginTop`    | `0`           | Page top margin in inches                                  |
| `marginLeft`   | `0`           | Page left margin in inches                                 |
| `marginRight`  | `0`           | Page right margin in inches                                |

## Attribution

I basically copied and adapted code from [this
guy](https://medium.com/@dschnr/using-headless-chrome-as-an-automated-screenshot-tool-4b07dffba79a).
My whole solution is obviously cobbled together from various slapped together
sources, but it fits my needs.