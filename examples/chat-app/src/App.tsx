import { useState, useEffect } from "react";
import { ConvexProvider, useQuery, useMutation } from "@vex/react";
import { ConvexClient } from "@vex/client";
import { api } from "../vex/_generated/api";

// Persist client across Vite HMR reloads to avoid stale WebSocket connections
const globalKey = "__vex_client__" as keyof typeof globalThis;
if (!(globalThis as any)[globalKey]) {
  (globalThis as any)[globalKey] = new ConvexClient("ws://localhost:8788/ws");
}
const client = (globalThis as any)[globalKey] as ConvexClient;

const CHANNELS = ["general", "random", "engineering"];

function Channel({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        marginBottom: 4,
        textAlign: "left",
        background: active ? "#e3f2fd" : "transparent",
        border: active ? "1px solid #90caf9" : "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      # {name}
    </button>
  );
}

function ChatPanel({ channel, author, onAuthorNeeded }: { channel: string; author: string; onAuthorNeeded: () => void }) {
  const messages = useQuery(api.messages.list, { channel });
  const sendMessage = useMutation(api.messages.send);
  const [body, setBody] = useState("");

  const handleSend = async () => {
    if (!author.trim()) {
      onAuthorNeeded();
      return;
    }
    if (!body.trim()) return;
    await sendMessage({ body, author, channel });
    setBody("");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", fontWeight: 600 }}>
        # {channel}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {(!messages || messages.length === 0) && (
          <p style={{ color: "#999" }}>No messages in #{channel} yet</p>
        )}
        {messages?.slice().reverse().map((msg: any) => (
          <div
            key={msg._id}
            style={{
              padding: "8px 12px",
              marginBottom: 6,
              background: "#f5f5f5",
              borderRadius: 4,
            }}
          >
            <strong>{msg.author}</strong>: {msg.body}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        style={{ padding: 12, borderTop: "1px solid #e0e0e0", display: "flex", gap: 8 }}
      >
        <input
          type="text"
          placeholder={`Message #${channel}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button type="submit" style={{ padding: "8px 16px", borderRadius: 4, border: "1px solid #ccc", cursor: "pointer" }}>
          Send
        </button>
      </form>
    </div>
  );
}

function Chat() {
  const [channel, setChannel] = useState("general");
  const [author, setAuthor] = useState("");
  const [connected, setConnected] = useState(false);
  const [authorMissing, setAuthorMissing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setConnected((client as any).ws?.readyState === WebSocket.OPEN);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (author.trim()) setAuthorMissing(false);
  }, [author]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", display: "flex", alignItems: "center", gap: 16 }}>
        <strong style={{ fontSize: 18 }}>Vex Chat</strong>
        <span style={{ color: connected ? "green" : "red", fontSize: 13 }}>
          {connected ? "Connected" : "Connecting..."}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <input
            type="text"
            placeholder="Your name"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            style={{ padding: 6, borderRadius: 4, border: authorMissing ? "2px solid red" : "1px solid #ccc" }}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 180, borderRight: "1px solid #e0e0e0", padding: 8 }}>
          {CHANNELS.map((ch) => (
            <Channel key={ch} name={ch} active={ch === channel} onClick={() => setChannel(ch)} />
          ))}
        </div>

        <ChatPanel channel={channel} author={author} onAuthorNeeded={() => setAuthorMissing(true)} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ConvexProvider client={client}>
      <Chat />
    </ConvexProvider>
  );
}
