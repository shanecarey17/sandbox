docker run -d --restart=always --env-file vars.env -e PRIVATE_KEY=$(cat .mainnet.key) liquidator
