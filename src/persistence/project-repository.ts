import type { Project } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import type { Database } from './database.js';

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  create(input: { name: string; rootPath: string }): Project {
    const project: Project = {
      projectId: newId('project'), name: input.name, rootPath: input.rootPath,
      status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO projects(project_id,name,root_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(project.projectId, project.name, project.rootPath, project.status, project.createdAt, project.updatedAt);
    return project;
  }

  get(projectId: string): Project | null {
    const row = this.db.raw.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
    return row ? {
      projectId: String(row.project_id), name: String(row.name), rootPath: String(row.root_path),
      status: row.status as Project['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    } : null;
  }
}
