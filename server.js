const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("GroupMe Roll Call Bot is running!");
});

app.post("/callback", (req, res) => {
  console.log("GroupMe message received:", req.body);

  // Tell GroupMe we received the message
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
