const fs = require("fs");

async function check() {
  const env = fs.readFileSync(".env.local", "utf-8");
  const start = env.indexOf("HELIUM10_COOKIES=");
  let jsonStr = env.slice(start + "HELIUM10_COOKIES=".length).trim();
  if (jsonStr.startsWith("'")) jsonStr = jsonStr.slice(1);
  if (jsonStr.endsWith("'")) jsonStr = jsonStr.slice(0, -1);
  const parsed = JSON.parse(jsonStr);
  const cookieHeader = parsed.map(c => `${c.name}=${c.value}`).join("; ");

  const url = "https://members.helium10.com/black-box/sales-estimator?asin=B0CGQJT3L3&marketplace=ATVPDKIKX0DER";
  const res = await fetch(url, {
    headers: {
      "Cookie": cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Sales Estimator Response:", data);
}

check();
