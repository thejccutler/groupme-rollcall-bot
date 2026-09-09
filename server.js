const express = require("express");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// Home page
app.get("/", (req, res) => {
  res.send("GroupMe Roll Call Bot is running!");
});

// Get the correct bot ID for the incoming GroupMe message
function getBotIdForGroup(message) {
  const mainBotId = process.env.GROUPME_BOT_ID;
  const testBotId = process.env.GROUPME_TEST_BOT_ID;

  // GroupMe callback messages include the bot_id when appropriate.
  // If it matches one of our bots, use that bot.
  if (message.bot_id === testBotId) {
    return testBotId;
  }

  return mainBotId;
}

// Create a unique Redis key for each GroupMe group
function getRollCallKey(message) {
  const groupId = message.group_id || "unknown";
  return `groupme:rollcall:${groupId}`;
}

// GroupMe callback
app.post("/callback", async (req, res) => {
  // Tell GroupMe we received the message
  res.sendStatus(200);

  try {
    const message = req.body;

    if (!message || !message.text) {
      return;
    }

    const text = message.text.trim();
    const name = message.name || "Unknown";
    const groupId = message.group_id || "unknown";

    console.log(`Message from ${name}: ${text}`);
    console.log(`Group ID: ${groupId}`);
    console.log(`Bot ID in message: ${message.bot_id || "none"}`);

    // Ignore messages sent by bots
    if (message.sender_type === "bot") {
      return;
    }

    const rollCallKey = getRollCallKey(message);

    // Load this group's roll call from Redis
    let rollCall = await redis.get(rollCallKey);

    if (!rollCall) {
      rollCall = {
        active: false,
        dateTime: "",
        responses: {}
      };
    }

    // START ROLL CALL
    if (text.toLowerCase().startsWith("!rollcall")) {
      const dateTime = text.substring(9).trim();

      if (!dateTime) {
        await sendMessage(
          getBotIdForGroup(message),
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

      await redis.set(rollCallKey, rollCall);

      await sendMessage(
        getBotIdForGroup(message),
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

    // SHOW ATTENDANCE
    if (text.toLowerCase() === "!attendance") {
      await sendAttendance(
        rollCall,
        getBotIdForGroup(message)
      );
      return;
    }

    // CLOSE ROLL CALL
    if (text.toLowerCase() === "!close") {
      if (!rollCall.active) {
        await sendMessage(
          getBotIdForGroup(message),
          "⚠️ There is no active roll call."
        );
        return;
      }

      rollCall.active = false;

      await redis.set(rollCallKey, rollCall);

      await sendAttendance(
        rollCall,
        getBotIdForGroup(message),
        "🔒 ROLL CALL CLOSED"
      );

      return;
    }

    // ATTENDANCE RESPONSES
    if (rollCall.active) {
      const response = text.toLowerCase();

      if (
        response === "in" ||
        response === "out" ||
        response === "maybe"
      ) {
        // Use GroupMe's user ID so the same person can't
        // accidentally appear twice if they change their name.
        const userId = message.user_id || name;

        rollCall.responses[userId] = {
          name: name,
          response: response
        };

        await redis.set(rollCallKey, rollCall);

        let confirmation;

        if (response === "in") {
          confirmation = `🟢 ${name} is IN!`;
        } else if (response === "out") {
          confirmation = `🔴 ${name} is OUT.`;
        } else {
          confirmation = `🟡 ${name} is MAYBE.`;
        }

        await sendMessage(
          getBotIdForGroup(message),
          confirmation
        );

        return;
      }
    }

  } catch (error) {
    console.error("Error processing GroupMe message:", error);
  }
});

// SEND ATTENDANCE REPORT
async function sendAttendance(
  rollCall,
  botId,
  header = "📋 CURRENT ATTENDANCE"
) {
  if (!rollCall.dateTime) {
    await sendMessage(
      botId,
      "⚠️ There is no active roll call."
    );
    return;
  }

  const inList = [];
  const outList = [];
  const maybeList = [];

  for (const person of Object.values(rollCall.responses || {})) {
    if (person.response === "in") {
      inList.push(person.name);
    } else if (person.response === "out") {
      outList.push(person.name);
    } else if (person.response === "maybe") {
      maybeList.push(person.name);
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

  await sendMessage(botId, message);
}

// SEND MESSAGE TO GROUPME
async function sendMessage(botId, text) {
  try {
    const response = await fetch(
      "https://api.groupme.com/v3/bots/post",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bot_id: botId,
          text: text
        })
      }
    );

    const result = await response.text();

    console.log(
      "Bot ID being used:",
      botId
    );

    console.log(
      "GroupMe response:",
      response.status,
      result
    );

  } catch (error) {
    console.error(
      "Error sending GroupMe message:",
      error
    );
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
