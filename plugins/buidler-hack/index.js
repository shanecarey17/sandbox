const assert = require('assert');

const { extendEnvironment } = require("@nomiclabs/buidler/config");
const { lazyObject } = require("@nomiclabs/buidler/plugins");

function MiddleWare(provider) {
    this._provider = provider;
}

module.exports = function() {
    extendEnvironment((env) => {
        assert('ethers' in env, 'You must usePlugin("@nomiclabs/buidler-ethers") before this plugin');

        if (!('other_urls' in env.network.config)) {
            return;
        }

        let provider = env.ethers.provider;
        provider._realSend = provider.send;

        let allUrls = [env.network.provider._url, ...env.network.config.other_urls];

        env.ethers.provider.send = (method, params) => {
            let url = provider._buidlerProvider._url;

            let idx = allUrls.indexOf(url);

            provider._buidlerProvider._url = allUrls[++idx % allUrls.length];

            return provider._realSend(method, params);
        }
    });
}