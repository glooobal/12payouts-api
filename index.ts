import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const symbol = Bun.argv[2] ?? "XTB.WA";
const roundPrice = (value: number | null | undefined) =>
  value == null ? value : Number(value.toFixed(5));

try {
  const quote = await yahooFinance.quote(symbol);

  console.log({
    symbol: quote.symbol,
    name: quote.shortName ?? quote.longName,
    price: quote.regularMarketPrice,
    currency: quote.currency,
    exchange: quote.fullExchangeName ?? quote.exchange,
    marketTime: quote.regularMarketTime?.toISOString(),
  });

  const period1 = new Date();
  period1.setDate(period1.getDate() - 30);
  const history = await yahooFinance.chart(symbol, {
    period1,
    interval: "1d",
  });
  const latestHistory = history.quotes
    .toSorted((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-10)
    .map(({ date, close, adjclose, volume }) => ({
      date: date.toISOString().slice(0, 10),
      close: roundPrice(close),
      adjustedClose: roundPrice(adjclose),
      volume,
    }));

  console.log({
    historySymbol: symbol,
    historyRowsInLast30Days: history.quotes.length,
    latestDailyRows: latestHistory,
  });
} catch (error) {
  console.error(`Could not fetch Yahoo Finance data for ${symbol}:`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
