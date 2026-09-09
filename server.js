const express = require("express");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Connect to Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// IMPORTANT:
// This is the production bot's Redis key.
const ROLL_CALL_KEY = "groupme:rollcall";

// Home page
app.get("/", (req, res) => {
  res.send("GroupMe Roll Call Bot is running!");
});

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
    const groupId = message.group_id;

    console.log(`Message from ${name}: ${text}`);

    // Ignore messages sent by bots
    if (message.sender_type === "bot") {
      return;
    }

    // Load the roll call from Redis
    let rollCall = await redis.get(ROLL_CALL_KEY);

    if (!rollCall) {
      rollCall = {
        active: false,
        dateTime: "",
        groupId: "",
        responses: {}
      };
    }

    // START ROLL CALL
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
        groupId: groupId,
        responses: {}
      };

      await redis.set(ROLL_CALL_KEY, rollCall);

      await sendMessage(
        `🥎 ROLL CALL OPEN\n\n` +
        `📅 ${dateTime}\n\n` +
        `Are you playing?\n\n` +
        `Reply with:\n` +
        `🟢 IN — I'm playing\n` +
        `🔴 OUT — Can't make it\n` +
        `🟡 MAYBE — Not sure yet\n\n` +
        `Use !attendance to see the current responses.`
      );

      return;
    }

    // SHOW ATTENDANCE
    if (text.toLowerCase() === "!attendance") {
      await sendAttendance(rollCall);
      return;
    }

    // CLOSE ROLL CALL
    if (text.toLowerCase() === "!close") {
      if (!rollCall.active) {
        await sendMessage(
          "⚠️ There is no active roll call."
        );
        return;
      }

      rollCall.active = false;

      await redis.set(ROLL_CALL_KEY, rollCall);

      await sendAttendance(
        rollCall,
        "🔒 ROLL CALL CLOSED"
      );

      return;
    }

    // ATTENDANCE RESPONSES
    if (rollCall.active) {
      // Normalize the message so different apostrophes work
      // Example: I'm in / I’m in
      const response = text
        .toLowerCase()
        .trim()
        .replace(/[’‘]/g, "'");

      let attendanceResponse = null;

      // --------------------------------
      // IN RESPONSES
      // --------------------------------
      if (
        response === "in" ||
        response === "i'm in" ||
        response === "im in" ||
        response === "i am in" ||
        response === "i'm playing" ||
        response === "im playing" ||
        response === "i am playing" ||
        response === "i'll play" ||
        response === "ill play" ||
        response === "i will play" ||
        response === "i'll be there" ||
        response === "ill be there" ||
        response === "i will be there" ||
        response === "yes" ||
        response === "yes i'm playing" ||
        response === "yes im playing" ||
        response === "yes i am playing"
      ) {
        attendanceResponse = "in";
      }

      // --------------------------------
      // OUT RESPONSES
      // --------------------------------
      else if (
        response === "out" ||
        response === "i'm out" ||
        response === "im out" ||
        response === "i am out" ||
        response === "i'm not playing" ||
        response === "im not playing" ||
        response === "i am not playing" ||
        response === "i can't make it" ||
        response === "i cant make it" ||
        response === "i cannot make it" ||
        response === "i won't be there" ||
        response === "i wont be there" ||
        response === "i will not be there" ||
        response === "no" ||
        response === "no i can't" ||
        response === "no i cant"
      ) {
        attendanceResponse = "out";
      }

      // --------------------------------
      // MAYBE RESPONSES
      // --------------------------------
      else if (
        response === "maybe" ||
        response === "i'm not sure" ||
        response === "im not sure" ||
        response === "i am not sure" ||
        response === "not sure" ||
        response === "i might be there" ||
        response === "i might play" ||
        response === "i may be there" ||
        response === "i may play"
      ) {
        attendanceResponse = "maybe";
      }

      // --------------------------------
      // SAVE RESPONSE
      // --------------------------------
      if (attendanceResponse) {
        const userId = message.user_id || name;

        rollCall.responses[userId] = {
          name: name,
          response: attendanceResponse
        };

        await redis.set(ROLL_CALL_KEY, rollCall);

        let confirmation;

        if (attendanceResponse === "in") {
          confirmation = `🟢 ${name} is IN!`;
        } else if (attendanceResponse === "out") {
          confirmation = `🔴 ${name} is OUT.`;
        } else {
          confirmation = `🟡 ${name} is MAYBE.`;
        }

        await sendMessage(confirmation);

        return;
      }
    }

  } catch (error) {
    console.error(
      "Error processing GroupMe message:",
      error
    );
  }
});

// ----------------------------------------
// GET CURRENT GROUP MEMBERS
// ----------------------------------------
async function getGroupMembers(groupId) {
  try {
    if (!groupId) {
      console.error("No GroupMe group ID available.");
      return [];
    }

    const response = await fetch(
      `https://api.groupme.com/v3/groups/${groupId}`,
      {
        method: "GET",
        headers: {
          "X-Access-Token": process.env.GROUPME_ACCESS_TOKEN,
          "Accept": "application/json"
        }
      }
    );

    const data = await response.json();

    console.log(
      "Group members request:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "GroupMe members API error:",
        data
      );

      return [];
    }

    return data.response?.members || [];

  } catch (error) {
    console.error(
      "Error getting GroupMe group members:",
      error
    );

    return [];
  }
}

// ----------------------------------------
// SEND ATTENDANCE REPORT
// ----------------------------------------
async function sendAttendance(
  rollCall,
  header = "📋 CURRENT ATTENDANCE"
) {
  if (!rollCall.dateTime) {
    await sendMessage(
      "⚠️ There is no active roll call."
    );
    return;
  }

  // Get the CURRENT members of the GroupMe group
  const members = await getGroupMembers(
    rollCall.groupId
  );

  if (members.length === 0) {
    await sendMessage(
      "⚠️ I couldn't retrieve the current GroupMe members."
    );
    return;
  }

  const inList = [];
  const outList = [];
  const maybeList = [];
  const noResponseList = [];

  // Create a lookup of people who responded
  const responses = rollCall.responses || {};

  // Compare every current GroupMe member
  // against the responses
  for (const member of members) {
    const userId = member.user_id;
    const memberName = member.nickname || "Unknown";

    const response = responses[userId];

    if (!response) {
      noResponseList.push(memberName);
    } else if (response.response === "in") {
      inList.push(response.name || memberName);
    } else if (response.response === "out") {
      outList.push(response.name || memberName);
    } else if (response.response === "maybe") {
      maybeList.push(response.name || memberName);
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
    `${formatList(maybeList)}\n\n` +

    `⚪ NO RESPONSE (${noResponseList.length})\n` +
    `${formatList(noResponseList)}`;

  await sendMessage(message);
}

// ----------------------------------------
// SEND MESSAGE TO PRODUCTION GROUPME BOT
// ----------------------------------------
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

    console.log(
      "Production Bot ID being used:",
      process.env.GROUPME_BOT_ID
    );

    console.log(
      "GroupMe response:",
      response.status,
      result
    );

  } catch (error) {
    console.error(
      "Error sending production GroupMe message:",
      error
    );
  }
}

app.listen(PORT, () => {
  console.log(`Production server running on port ${PORT}`);
});
