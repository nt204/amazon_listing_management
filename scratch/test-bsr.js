const fs = require("fs");

async function check() {
  const env = fs.readFileSync(".env.local", "utf-8");
  const start = env.indexOf("HELIUM10_COOKIES=");
  let jsonStr = env.slice(start + "HELIUM10_COOKIES=".length).trim();
  if (jsonStr.startsWith("'")) jsonStr = jsonStr.slice(1);
  if (jsonStr.endsWith("'")) jsonStr = jsonStr.slice(0, -1);
  const parsed = JSON.parse(jsonStr);
  const cookieHeader = parsed.map(c => `${c.name}=${c.value}`).join("; ");

  const url = "https://members.helium10.com/extension/calculator-v2?asin=B0CGQJT3L3&marketplace=ATVPDKIKX0DER";
  const res = await fetch(url, {
    headers: {
      "Cookie": cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "chrome-extension://njmehopjdpcckochcggncklnlmikcbnb",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty"
    }
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text.slice(0, 500));
}

check();
