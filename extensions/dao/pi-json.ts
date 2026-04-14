// ============================================================
// pi-swarm-dao — Pi JSON Event Stream Parser
// ============================================================

/**
 * Extract the assistant's text message from Pi's JSON event stream.
 * Pi in --mode json emits newline-delimited JSON events.
 * We look for message_end events with the assistant's content,
 * falling back to accumulated text_delta events.
 */
export function extractAssistantMessage(jsonStream: string): string {
  let fullText = "";
  let start = 0;

  while (start < jsonStream.length) {
    let end = jsonStream.indexOf("\n", start);
    if (end === -1) end = jsonStream.length;

    const line = jsonStream.substring(start, end).trim();
    start = end + 1;

    if (!line) continue;

    try {
      const event = JSON.parse(line);

      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        fullText += event.assistantMessageEvent.delta;
      }

      if (event.type === "message_end" && event.message?.content) {
        const textBlocks = event.message.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text);
        if (textBlocks.length > 0) {
          return textBlocks.join("\n");
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return fullText;
}
