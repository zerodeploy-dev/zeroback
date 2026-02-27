import { useState, useEffect } from "react";
import {
  ConvexProvider,
  useQuery,
  useMutation,
  useConnectionState,
} from "@vex/react";
import { ConvexClient } from "@vex/client";
import { api } from "../vex/_generated/api";
import { Board } from "./Board";
import { TaskDetail } from "./TaskDetail";
import "./styles.css";

const globalKey = "__vex_client__" as keyof typeof globalThis;
if (!(globalThis as any)[globalKey]) {
  (globalThis as any)[globalKey] = new ConvexClient("ws://localhost:8788/ws");
}
const client = (globalThis as any)[globalKey] as ConvexClient;

export function App() {
  return (
    <ConvexProvider client={client}>
      <TaskManager />
    </ConvexProvider>
  );
}

function TaskManager() {
  const connectionState = useConnectionState();
  const projects = useQuery(api.projects.list, {});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState<string | null>(null);

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
          Vex Tasks
        </div>
        <span className={`connection-badge ${connectionState}`}>
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "connecting"
              ? "Connecting..."
              : "Disconnected"}
        </span>
        <div className="header-user">
          <input
            type="text"
            placeholder="Your name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
          />
        </div>
      </div>

      <div className="main">
        <Sidebar
          projects={projects}
          selectedId={selectedProjectId}
          onSelect={(id) => {
            setSelectedProjectId(id);
            setSelectedTaskId(null);
          }}
          onCreateProject={() => setShowCreateProject(true)}
        />

        {selectedProjectId ? (
          <Board
            projectId={selectedProjectId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onCreateTask={(status) => setShowCreateTask(status)}
          />
        ) : (
          <div className="board-empty">Select a project to get started</div>
        )}

        {selectedTaskId && (
          <TaskDetail
            taskId={selectedTaskId}
            userName={userName}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} />
      )}

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

function Sidebar({
  projects,
  selectedId,
  onSelect,
  onCreateProject,
}: {
  projects: any[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateProject: () => void;
}) {

  return (
    <div className="sidebar">
      <div className="sidebar-header">Projects</div>
      <div className="sidebar-list">
        {projects === undefined && (
          <div style={{ padding: "8px 10px", color: "var(--text-tertiary)", fontSize: 13 }}>
            Loading...
          </div>
        )}
        {projects?.map((project: any) => (
          <button
            key={project._id}
            className={`project-item${project._id === selectedId ? " active" : ""}`}
            onClick={() => onSelect(project._id)}
          >
            <div className="project-dot" style={{ background: project.color }} />
            {project.name}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="btn-add" onClick={onCreateProject}>
          + New project
        </button>
      </div>
    </div>
  );
}

const PROJECT_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#ef4444",
  "#3b82f6",
  "#22c55e",
];

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const createProject = useMutation(api.projects.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createProject({ name, description, color });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">New Project</div>
        <div className="modal-body">
          <div className="form-group">
            <label>Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this project about?"
            />
          </div>
          <div className="form-group">
            <label>Color</label>
            <div style={{ display: "flex", gap: 6 }}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    border: color === c ? "2px solid var(--text)" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
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
