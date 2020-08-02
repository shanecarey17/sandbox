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
        let table = `
            <table class="table table-striped table-sm">
              <tbody>
                  ${$.map(routes, (route, idx) => {
                      return `
                          <tr>
                              <td>${route.trades[0].src}</td>
                              ${$.map(route.trades, (trade) => {
                                  return `
                                      <td>Rate</td>
                                      <td>${trade.dst}</td>
                                  `;
                              }).join('')}
                              <td>Profit</td>
                          </tr>
                          <tr>
                              <td>${route.trades[0].srcAmount}</td>
                              ${$.map(route.trades, (trade) => {
                                  return `
                                      <td>${trade.exchRate}</td>
                                      <td>${trade.dstAmount}</td>
                                  `;
                              }).join('')}
                              <td>${route.srcProfit}</td>
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