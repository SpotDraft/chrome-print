# multi-stage build new in Docker 17.05 (https://docs.docker.com/engine/userguide/eng-image/multistage-build/)
FROM yukinying/chrome-headless
FROM node:14.21.3-bullseye

# chrome dependencies
RUN apt-get update -y && apt-get upgrade -y && apt-get install -y -q libnss3 && mv /etc/fonts /etc/fonts.bak && apt-get install --reinstall fontconfig && rm -rf /var/lib/apt/lists/*

COPY --from=0 /chrome /chrome

COPY package* /server/
WORKDIR /server
RUN npm i

ADD . /server

EXPOSE 8888

ENTRYPOINT ["./start.sh"]
CMD ["/chrome/headless_shell", "--no-sandbox", "--hide-scrollbars", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222"]
