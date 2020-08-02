$(document).ready( function() {
    var ws = new WebSocket('ws://localhost:8080');

    let currRates = null;

    function updateRates(rates) {
        let table = `
            <table class="table table-striped table-sm">
              <thead>
                <th>*</th>
                ${Object.keys(rates).map((symbol) => {
                    return `<th>${symbol}</th>`
                }).join('')}
              </thead>
              <tbody>
                ${$.map(rates, (exchRates, symbol) => {
                    return `<tr><td>${symbol}</td>${Object.keys(rates).map((col) => {
                        let color = "";
                        if (currRates !== null && currRates[symbol][col] != rates[symbol][col]) {
                            color = "table-success";
                        }

                        return `<td class=${color}>${exchRates[col]}</td>`;
                    }).join('')}</tr>`;
                }).join('')}
              </tbody>
            </table>
        `;

        $('#rates-table-div').html(table);

        currRates = rates;
    }

    function updateRoutes(routes) {
        routes.sort((lhs, rhs) => {
            return lhs.ethProfit > rhs.ethProfit ? -1 : 1;
        });

        let table = `
            <table class="table table-striped table-sm">
              <thead>
                <th></th>
                <th>src</th>
                <th>amt</th>
                <th>rate</th>
                <th>dst</th>
                <th>amt</th>
                <th>rate</th>
                <th>dst</th>
                <th>amt</th>
                <th>rate</th>
                <th>dst</th>
                <th>amt</th>
                <th>profit src</th>
                <th>profit eth</th>
                <th>profit usd</th>
              </thead>
              <tbody>
                  ${$.map(routes, (route, idx) => {
                      return `
                          <tr>
                              <td>${idx}</td>
                              <td>${route.trades[0].src}</td>
                              <td>${route.trades[0].srcAmount}</td>
                              ${$.map(route.trades, (trade) => {
                                  return `
                                      <td>${trade.exchRate}</td>
                                      <td>${trade.dst}</td>
                                      <td>${trade.dstAmount}</td>
                                  `;
                              }).join('')}
                              <td>${route.srcProfit}</td>
                              <td>${route.ethProfit}</td>
                              <td>${route.usdProfit}</td>
                          </tr>
                      `;
                  }).join('')}
              </tbody>
            </table>
        `;

        $('#routes-table-div').html(table);
    }

    ws.onmessage = function(event) {
        var message = JSON.parse(event.data);

        console.log(message);

        if ('rates' in message) {
            updateRates(message.rates);
        }

        if ('routes' in message) {
            updateRoutes(message.routes);
        }
    }

    ws.onopen = function() {
        console.log('WEBSOCKET OPENED');
    }

    ws.onclose = function() {
        console.log('WEBSOCKET CLOSED');
    }
});