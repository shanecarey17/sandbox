docker stop $(cat container.txt)
docker rm $(cat container.txt)
docker build -t liquidator .
docker run \
	-d \
	--restart=always \
	--env-file vars.env \
	-e PRIVATE_KEY=$(cat .mainnet.key) \
	-e COINBASE_SECRET=$(cat .coinbase_secret.txt) \
	liquidator \
	> container.txt
