const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Current roll call
let rollCall = {
  active: false,
  dateTime: "",
  responses: {}
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

  // Ignore messages sent by the bot itself
  if (message.sender_type === "bot") {
    return;
  }

  // ==============================
  // START ROLL CALL
  // ==============================

  if (text.toLowerCase().startsWith("!rollcall")) {
    const dateTime = text.substring(9).trim();

    if (!dateTime) {
      await sendMessage(
        "⚠️ Please specify a date and time.\n\n" +
        "Example:\n" +
        "!rollcall September 15 at 7:00 PM"
      );
      return;
    }

    rollCall = {
      active: true,
      dateTime: dateTime,
      responses: {}
    };

    await sendMessage(
      `🥎 ROLL CALL OPEN\n\n` +
      `📅 ${dateTime}\n\n` +
      `Are you playing?\n\n` +
      `Reply:\n` +
      `🟢 IN — I'm playing\n` +
      `🔴 OUT — Can't make it\n` +
      `🟡 MAYBE — Not sure yet\n\n` +
      `Use !attendance to see the current responses.`
    );

    return;
  }

  // ==============================
  // ATTENDANCE RESPONSES
  // ==============================

  if (rollCall.active) {
    const response = text.toLowerCase();

    if (
      response === "in" ||
      response === "out" ||
      response === "maybe"
    ) {
      rollCall.responses[name] = response;

      let confirmation;

      if (response === "in") {
        confirmation = `🟢 ${name} is IN!`;
      } else if (response === "out") {
        confirmation = `🔴 ${name} is OUT.`;
      } else {
        confirmation = `🟡 ${name} is MAYBE.`;
      }

      await sendMessage(confirmation);
      return;
    }
  }

  // ==============================
  // SHOW ATTENDANCE
  // ==============================

  if (text.toLowerCase() === "!attendance") {
    await sendAttendance();
    return;
  }

  // ==============================
  // CLOSE ROLL CALL
  // ==============================

  if (text.toLowerCase() === "!close") {
    if (!rollCall.active) {
      await sendMessage("⚠️ There is no active roll call.");
      return;
    }

    rollCall.active = false;

    await sendAttendance("🔒 ROLL CALL CLOSED");

    return;
  }
});

// =====================================
// SEND ATTENDANCE REPORT
// =====================================

async function sendAttendance(header = "📋 CURRENT ATTENDANCE") {
  if (!rollCall.dateTime) {
    await sendMessage("⚠️ There is no active roll call.");
    return;
  }

  const inList = [];
  const outList = [];
  const maybeList = [];

  for (const [name, response] of Object.entries(rollCall.responses)) {
    if (response === "in") {
      inList.push(name);
    } else if (response === "out") {
      outList.push(name);
    } else if (response === "maybe") {
      maybeList.push(name);
    }
  }

  const formatList = (list) => {
    if (list.length === 0) {
      return "None";
    }

    return list
      .map((name, index) => `${index + 1}. ${name}`)
      .join("\n");
  };

  const message =
    `${header}\n\n` +
    `📅 ${rollCall.dateTime}\n\n` +
    `🟢 IN (${inList.length})\n` +
    `${formatList(inList)}\n\n` +
    `🔴 OUT (${outList.length})\n` +
    `${formatList(outList)}\n\n` +
    `🟡 MAYBE (${maybeList.length})\n` +
    `${formatList(maybeList)}`;

  await sendMessage(message);
}

// =====================================
// SEND MESSAGE TO GROUPME
// =====================================

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

    console.log("Bot ID being used:", process.env.GROUPME_BOT_ID);
    console.log("GroupMe response:", response.status, result);

  } catch (error) {
    console.error("Error sending GroupMe message:", error);
  }
}

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
