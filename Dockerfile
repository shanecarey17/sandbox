FROM node:12-alpine
RUN apk update && apk upgrade && apk add --no-cache bash git openssh python build-base
WORKDIR /app
ADD package.json /app
RUN npm install --only=production
ADD . /app/
RUN mkdir var
CMD npx buidler runLiquidator --network mainnet
