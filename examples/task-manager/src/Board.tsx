import { useQuery, useMutation } from "@zeroback/react";
import { api } from "../zeroback/_generated/api";

const STATUS_COLUMNS = [
  { key: "todo", label: "Todo", color: "#94a3b8" },
  { key: "in_progress", label: "In Progress", color: "#3b82f6" },
  { key: "done", label: "Done", color: "#22c55e" },
] as const;

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

export function Board({
  projectId,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
}: {
  projectId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onCreateTask: (status: string) => void;
}) {
  const tasks = useQuery(api.tasks.listByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);

  if (!tasks) {
    return <div className="board-empty">Loading tasks...</div>;
  }

  const tasksByStatus: Record<string, Task[]> = { todo: [], in_progress: [], done: [] };
  for (const task of tasks as Task[]) {
    if (tasksByStatus[task.status]) {
      tasksByStatus[task.status].push(task);
    }
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    await updateTask({
      id: taskId,
      title: undefined,
      status: newStatus,
      priority: undefined,
      description: undefined,
      assignee: undefined,
      dueDate: undefined,
      labels: undefined,
    });
  };

  return (
    <div className="board">
      {STATUS_COLUMNS.map((col) => (
        <div className="column" key={col.key}>
          <div className="column-header">
            <div className="column-status-dot" style={{ background: col.color }} />
            <span className="column-title">{col.label}</span>
            <span className="column-count">{tasksByStatus[col.key].length}</span>
          </div>
          <div className="column-tasks">
            {tasksByStatus[col.key].map((task) => (
              <TaskCard
                key={task._id}
                task={task}
                selected={task._id === selectedTaskId}
                onClick={() => onSelectTask(task._id === selectedTaskId ? null : task._id)}
                onStatusChange={handleStatusChange}
                columns={STATUS_COLUMNS}
                currentStatus={col.key}
              />
            ))}
            <button className="btn-add" onClick={() => onCreateTask(col.key)}>
              + Add task
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  selected,
  onClick,
  onStatusChange,
  columns,
  currentStatus,
}: {
  task: Task;
  selected: boolean;
  onClick: () => void;
  onStatusChange: (id: string, status: string) => void;
  columns: typeof STATUS_COLUMNS;
  currentStatus: string;
}) {
  const nextStatus = columns[(columns.findIndex((c) => c.key === currentStatus) + 1) % columns.length];

  return (
    <div className={`task-card${selected ? " selected" : ""}`} onClick={onClick}>
      <div className="task-title">{task.title}</div>
      <div className="task-meta">
        <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
        {task.assignee && <span className="task-assignee">{task.assignee}</span>}
        {task.labels && task.labels.length > 0 && (
          <div className="task-labels">
            {task.labels.map((label) => (
              <span key={label} className="label-tag">{label}</span>
            ))}
          </div>
        )}
        <button
          className="btn btn-ghost"
          style={{ marginLeft: "auto", fontSize: 11, padding: "2px 6px" }}
          onClick={(e) => {
            e.stopPropagation();
            onStatusChange(task._id, nextStatus.key);
          }}
          title={`Move to ${nextStatus.label}`}
        >
          &rarr; {nextStatus.label}
        </button>
      </div>
    </div>
  );
}
