import crypto from 'node:crypto';
import { db } from '../database/db.js';
import type { Task, TaskStep, TaskStatus } from '../../shared/types.js';

class TaskEngine {
  private activeLocks = new Set<string>();

  acquireLock(resourceKey: string): boolean {
    if (this.activeLocks.has(resourceKey)) {
      return false;
    }
    this.activeLocks.add(resourceKey);
    return true;
  }

  releaseLock(resourceKey: string) {
    this.activeLocks.delete(resourceKey);
  }

  createTask(agent: string, request: string, plan: string[], gatewayKeyId?: string): Task {
    const taskId = `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const steps: TaskStep[] = plan.map((title, idx) => ({
      id: `step_${idx + 1}`,
      taskId,
      title,
      status: 'pending',
      timestamp: new Date().toISOString(),
    }));

    const task: Task = {
      id: taskId,
      agent,
      request,
      plan,
      status: 'planning',
      currentStep: 0,
      totalSteps: plan.length,
      steps,
      gatewayKeyId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.saveTask(task);
    return task;
  }

  updateTaskStep(
    taskId: string,
    stepIndex: number,
    status: TaskStep['status'],
    details?: string
  ): Task | null {
    const task = db.getTaskById(taskId);
    if (!task) return null;

    if (task.steps[stepIndex]) {
      task.steps[stepIndex].status = status;
      task.steps[stepIndex].timestamp = new Date().toISOString();
      if (details) task.steps[stepIndex].details = details;
    }

    task.currentStep = stepIndex + 1;
    task.updatedAt = new Date().toISOString();
    if (status === 'running') task.status = 'executing';
    if (status === 'failed') task.status = 'failed';

    db.saveTask(task);
    return task;
  }

  completeTask(taskId: string, result: any): Task | null {
    const task = db.getTaskById(taskId);
    if (!task) return null;
    task.status = 'completed';
    task.result = result;
    task.updatedAt = new Date().toISOString();
    db.saveTask(task);
    return task;
  }

  failTask(taskId: string, error: string): Task | null {
    const task = db.getTaskById(taskId);
    if (!task) return null;
    task.status = 'failed';
    task.error = error;
    task.updatedAt = new Date().toISOString();
    db.saveTask(task);
    return task;
  }

  cancelTask(taskId: string, reason?: string): Task | null {
    const task = db.getTaskById(taskId);
    if (!task) return null;
    task.status = 'cancelled';
    task.error = reason || 'Cancelled by user';
    task.updatedAt = new Date().toISOString();
    db.saveTask(task);
    return task;
  }
}

export const taskEngine = new TaskEngine();
