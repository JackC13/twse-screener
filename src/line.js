// LINE 推播（Messaging API push）。沒設定 token 時只印出內容。

export async function pushLine(text, { token = process.env.LINE_CHANNEL_ACCESS_TOKEN, to = process.env.LINE_TO } = {}) {
  if (!token || !to) {
    console.log("（未設定 LINE_CHANNEL_ACCESS_TOKEN / LINE_TO，略過推播）\n" + text);
    return false;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) throw new Error(`LINE 推播失敗：HTTP ${res.status} ${await res.text()}`);
  return true;
}
