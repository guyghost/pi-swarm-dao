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
  const lines = jsonStream.split("\n").filter((l) => l.trim());
  let fullText = "";

  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      // Accumulate text deltas from message_update events
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        fullText += event.assistantMessageEvent.delta;
      }

      // Or capture the final message content from message_end
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

  // Fall back to accumulated text deltas
  return fullText;
}
