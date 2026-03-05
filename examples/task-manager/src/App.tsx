import { useState, useEffect, useRef } from "react";
import {
  ZerobackProvider,
  useQuery,
  useMutation,
  useConnectionState,
} from "@zeroback/react";
import { ZerobackClient } from "@zeroback/client";
import { api } from "../zeroback/_generated/api";
import { Board } from "./Board";
import { TaskDetail } from "./TaskDetail";
import "./styles.css";

const globalKey = "__zeroback_client__" as keyof typeof globalThis;
if (!(globalThis as any)[globalKey]) {
  (globalThis as any)[globalKey] = new ZerobackClient("ws://localhost:8788/ws");
}
const client = (globalThis as any)[globalKey] as ZerobackClient;

const ADJECTIVES = ["Swift", "Bold", "Calm", "Keen", "Wise", "Bright", "Quick", "Sharp", "Brave", "Noble"];
const NOUNS = ["Fox", "Hawk", "Wolf", "Bear", "Lynx", "Falcon", "Otter", "Raven", "Tiger", "Eagle"];

function getOrCreateUserName(): string {
  const stored = localStorage.getItem("zeroback_username");
  if (stored) return stored;
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100);
  const name = `${adj}${noun}${num}`;
  localStorage.setItem("zeroback_username", name);
  return name;
}

export function App() {
  return (
    <ZerobackProvider client={client}>
      <TaskManager />
    </ZerobackProvider>
  );
}

function TaskManager() {
  const connectionState = useConnectionState();
  const projects = useQuery(api.projects.list, {});
  const createProject = useMutation(api.projects.create);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [userName] = useState(() => getOrCreateUserName());
  const [showCreateTask, setShowCreateTask] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Auto-seed default project when DB is empty
  useEffect(() => {
    if (projects && projects.length === 0 && !seededRef.current) {
      seededRef.current = true;
      createProject({ name: "My Project", description: "Default project", color: "#6366f1" });
    }
  }, [projects]);

  // Auto-select first project
  useEffect(() => {
    if (!selectedProjectId && projects && projects.length > 0) {
      setSelectedProjectId((projects[0] as any)._id);
    }
  }, [projects, selectedProjectId]);

  return (
    <div className="app">
      <div className="header">
        <div className="header-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          </svg>
          Zero Tasks
        </div>
        <span className={`connection-badge ${connectionState}`}>
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </span>
        <div className="header-user">
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{userName}</span>
        </div>
      </div>

      <div className="main">
        {selectedProjectId ? (
          <Board
            projectId={selectedProjectId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onCreateTask={(status) => setShowCreateTask(status)}
          />
        ) : (
          <div className="board-empty">Loading project...</div>
        )}

        {selectedTaskId && (
          <TaskDetail
            taskId={selectedTaskId}
            userName={userName}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

      {showCreateTask && selectedProjectId && (
        <CreateTaskModal
          projectId={selectedProjectId}
          defaultStatus={showCreateTask}
          onClose={() => setShowCreateTask(null)}
        />
      )}
    </div>
  );
}

function CreateTaskModal({
  projectId,
  defaultStatus,
  onClose,
}: {
  projectId: string;
  defaultStatus: string;
  onClose: () => void;
}) {
  const createTask = useMutation(api.tasks.create, {
    optimisticUpdate: (store, args) => {
      const current = store.getQuery(api.tasks.listByProject, { projectId }) as any[];
      if (current) {
        store.setQuery(api.tasks.listByProject, { projectId }, [
          {
            _id: "optimistic_" + Date.now(),
            _creationTime: Date.now(),
            ...args,
          },
          ...current,
        ]);
      }
    },
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await createTask({
      title,
      description: description || undefined,
      status: defaultStatus,
      priority,
      projectId,
      assignee: assignee || undefined,
      dueDate: undefined,
      labels: undefined,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">New Task</div>
        <div className="modal-body">
          <div className="form-group">
            <label>Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details..."
            />
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="form-group">
            <label>Assignee</label>
            <input
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Who's working on this?"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
