FROM node:12-alpine
RUN apk update && apk upgrade && apk add --no-cache bash git openssh
WORKDIR /app
ADD package.json /app
RUN npm install
ADD . /app/
CMD npx buidler runLiquidator --network mainnet
