const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Store the current roll call in memory
let rollCall = {
  active: false,
  in: [],
  out: [],
  maybe: []
};

// Home page
app.get("/", (req, res) => {
  res.send("GroupMe Roll Call Bot is running!");
});

// GroupMe callback
app.post("/callback", async (req, res) => {
  // Tell GroupMe we received the message
  res.sendStatus(200);

  const message = req.body;

  if (!message || !message.text) {
    return;
  }

  const text = message.text.trim();
  const name = message.name || "Unknown";

  console.log(`Message from ${name}: ${text}`);

  // Start a roll call
  if (text.toLowerCase() === "!rollcall") {
    rollCall = {
      active: true,
      in: [],
      out: [],
      maybe: []
    };

    await sendMessage(
      "🥎 ROLL CALL IS OPEN!\n\n" +
      "Are you playing tonight?\n\n" +
      "Reply with:\n" +
      "IN — I'm playing\n" +
      "OUT — Can't make it\n" +
      "MAYBE — Not sure yet"
    );

    return;
  }

  // Ignore attendance responses if roll call isn't active
  if (!rollCall.active) {
    return;
  }

  const response = text.toLowerCase();

  if (response === "in") {
    addPlayer(name, "in");
    await sendMessage(`✅ ${name} is IN!`);
  }

  else if (response === "out") {
    addPlayer(name, "out");
    await sendMessage(`❌ ${name} is OUT.`);
  }

  else if (response === "maybe") {
    addPlayer(name, "maybe");
    await sendMessage(`🤔 ${name} is MAYBE.`);
  }

  // Show attendance
  else if (response === "!attendance") {
    await sendAttendance();
  }

  // Close roll call
  else if (response === "!close") {
    rollCall.active = false;

    await sendAttendance("🔒 ROLL CALL CLOSED");
  }
});

// Add/update a player
function addPlayer(name, status) {
  // Remove player from every list first
  rollCall.in = rollCall.in.filter(player => player !== name);
  rollCall.out = rollCall.out.filter(player => player !== name);
  rollCall.maybe = rollCall.maybe.filter(player => player !== name);

  // Add them to their new status
  rollCall[status].push(name);
}

// Send attendance list
async function sendAttendance(header = "📋 CURRENT ATTENDANCE") {
  const inList = rollCall.in.length
    ? rollCall.in.map((name, i) => `${i + 1}. ${name}`).join("\n")
    : "None";

  const outList = rollCall.out.length
    ? rollCall.out.map((name, i) => `${i + 1}. ${name}`).join("\n")
    : "None";

  const maybeList = rollCall.maybe.length
    ? rollCall.maybe.map((name, i) => `${i + 1}. ${name}`).join("\n")
    : "None";

  const message =
    `${header}\n\n` +
    `🟢 IN (${rollCall.in.length})\n${inList}\n\n` +
    `🔴 OUT (${rollCall.out.length})\n${outList}\n\n` +
    `🟡 MAYBE (${rollCall.maybe.length})\n${maybeList}`;

  await sendMessage(message);
}

// Send message back to GroupMe
async function sendMessage(text) {
  try {
    const response = await fetch(
      "https://api.groupme.com/v3/bots/post",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bot_id: process.env.GROUPME_BOT_ID,
          text: text
        })
      }
    );

    const result = await response.text();

    console.log("GroupMe response:", response.status, result);

  } catch (error) {
    console.error("Error sending GroupMe message:", error);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
