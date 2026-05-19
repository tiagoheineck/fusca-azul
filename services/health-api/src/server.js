const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "health-api",
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`health-api running on port ${port}`);
});
