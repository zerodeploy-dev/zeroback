import { useState } from "react";
import { useQuery, useMutation } from "@zeroback/react";
import { api } from "../zeroback/_generated/api";

interface Task {
  _id: string;
  _creationTime: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  projectId: string;
  assignee?: string;
  labels?: string[];
}

export function TaskDetail({
  taskId,
  userName,
  onClose,
}: {
  taskId: string;
  userName: string;
  onClose: () => void;
}) {
  const task = useQuery(api.tasks.get, { id: taskId }) as Task | null | undefined;
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  if (task === undefined) {
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <span className="detail-title">Loading...</span>
          <button className="detail-close" onClick={onClose}>&times;</button>
        </div>
      </div>
    );
  }

  if (task === null) {
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <span className="detail-title">Task not found</span>
          <button className="detail-close" onClick={onClose}>&times;</button>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    await removeTask({ id: taskId });
    onClose();
  };

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-title">{task.title}</span>
        <button className="detail-close" onClick={onClose}>&times;</button>
      </div>

      <div className="detail-fields">
        <div className="detail-field">
          <span className="detail-field-label">Status</span>
          <select
            className="status-select"
            value={task.status}
            onChange={(e) => updateTask({
              id: taskId,
              title: undefined,
              status: e.target.value,
              priority: undefined,
              description: undefined,
              assignee: undefined,
              dueDate: undefined,
              labels: undefined,
            })}
          >
            <option value="todo">Todo</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div className="detail-field">
          <span className="detail-field-label">Priority</span>
          <select
            className="priority-select"
            value={task.priority}
            onChange={(e) => updateTask({
              id: taskId,
              title: undefined,
              status: undefined,
              priority: e.target.value,
              description: undefined,
              assignee: undefined,
              dueDate: undefined,
              labels: undefined,
            })}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        {task.assignee && (
          <div className="detail-field">
            <span className="detail-field-label">Assignee</span>
            <span className="detail-field-value">{task.assignee}</span>
          </div>
        )}
        {task.labels && task.labels.length > 0 && (
          <div className="detail-field">
            <span className="detail-field-label">Labels</span>
            <div className="task-labels">
              {task.labels.map((label) => (
                <span key={label} className="label-tag">{label}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {task.description && (
        <div className="detail-description">{task.description}</div>
      )}

      <Comments taskId={taskId} userName={userName} />

      <div style={{ padding: 16, borderTop: "1px solid var(--border-light)" }}>
        <button className="btn btn-danger" style={{ width: "100%" }} onClick={handleDelete}>
          Delete task
        </button>
      </div>
    </div>
  );
}

function Comments({ taskId, userName }: { taskId: string; userName: string }) {
  const commentsData = useQuery(api.comments.listByTask, {
    taskId,
    numItems: 50,
  }) as { page: any[]; continueCursor: string | null; isDone: boolean } | undefined;
  const addComment = useMutation(api.comments.add);
  const [body, setBody] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !userName.trim()) return;
    await addComment({ body, author: userName, taskId });
    setBody("");
  };

  const comments = (commentsData?.page ?? []) as Array<{
    _id: string;
    _creationTime: number;
    body: string;
    author: string;
  }>;
  const loading = commentsData === undefined;

  return (
    <div className="comments-section">
      <div className="comments-header">
        Comments {loading ? "" : `(${comments.length})`}
      </div>

      <div className="comments-list">
        {loading && (
          <div style={{ padding: "8px 0", color: "var(--text-tertiary)", fontSize: 13 }}>
            Loading...
          </div>
        )}
        {comments
          .slice()
          .reverse()
          .map((comment) => (
            <div key={comment._id} className="comment">
              <div className="comment-author">{comment.author}</div>
              <div className="comment-body">{comment.body}</div>
              <div className="comment-time">
                {new Date(comment._creationTime).toLocaleString()}
              </div>
            </div>
          ))}
      </div>

      <form className="comment-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={userName ? "Add a comment..." : "Set your name first"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={!userName.trim()}
        />
        <button className="btn btn-primary" type="submit" disabled={!userName.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
