import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { HttpError } from "../errors.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  boardTakeover: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  release: vi.fn(),
  checkout: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
  listLabels: vi.fn(),
  getLabelById: vi.fn(),
  createLabel: vi.fn(),
  addLabelToIssue: vi.fn(),
  removeLabelFromIssue: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  upsertDocument: vi.fn(),
  listAttachments: vi.fn(),
  heartbeatContext: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  listByIds: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  issueService: () => mockIssueService,
  projectService: () => mockProjectService,
  heartbeatService: () => mockHeartbeatService,
  logActivity: mockLogActivity,
  accessService: () => ({}),
  agentService: () => ({ getById: vi.fn().mockResolvedValue(null) }),
  goalService: () => ({ getById: vi.fn(), getDefaultCompanyGoal: vi.fn() }),
  issueApprovalService: () => ({}),
  executionWorkspaceService: () => ({}),
  workProductService: () => ({}),
  documentService: () => ({}),
  routineService: () => ({}),
}));

const COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const ISSUE_ID = "20000000-0000-0000-0000-000000000001";
const AGENT_ID = "30000000-0000-0000-0000-000000000001";
const OTHER_AGENT_ID = "30000000-0000-0000-0000-000000000002";

function createApp(actorType: "board" | "agent", agentId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (actorType === "board") {
      (req as any).actor = {
        type: "board",
        userId: "user-1",
        companyIds: [COMPANY_ID],
        source: "local_implicit",
        isInstanceAdmin: false,
      };
    } else {
      (req as any).actor = {
        type: "agent",
        agentId: agentId ?? AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_jwt",
        runId: "40000000-0000-0000-0000-000000000001",
      };
    }
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

const staleInReviewIssue = {
  id: ISSUE_ID,
  companyId: COMPANY_ID,
  status: "in_review",
  assigneeAgentId: AGENT_ID,
  checkoutRunId: "old-run-1",
  executionRunId: null,
  title: "Some issue",
};

const takenOverIssue = {
  ...staleInReviewIssue,
  status: "todo",
  assigneeAgentId: null,
  checkoutRunId: null,
};

describe("POST /api/issues/:id/board-takeover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
  });

  it("board user can take over stale in_review issue with null executionRunId", async () => {
    mockIssueService.getById.mockResolvedValue(staleInReviewIssue);
    mockIssueService.boardTakeover.mockResolvedValue(takenOverIssue);

    const app = createApp("board");
    const res = await request(app).post(`/api/issues/${ISSUE_ID}/board-takeover`).send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("todo");
    expect(res.body.assigneeAgentId).toBeNull();
    expect(mockIssueService.boardTakeover).toHaveBeenCalledWith(ISSUE_ID);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.board_takeover" }),
    );
  });

  it("returns 403 for agent callers", async () => {
    const app = createApp("agent");
    const res = await request(app).post(`/api/issues/${ISSUE_ID}/board-takeover`).send();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Board access required" });
    expect(mockIssueService.boardTakeover).not.toHaveBeenCalled();
  });

  it("returns 404 when issue does not exist", async () => {
    mockIssueService.getById.mockResolvedValue(null);

    const app = createApp("board");
    const res = await request(app).post(`/api/issues/${ISSUE_ID}/board-takeover`).send();

    expect(res.status).toBe(404);
    expect(mockIssueService.boardTakeover).not.toHaveBeenCalled();
  });

  it("returns 409 when issue has active executionRunId", async () => {
    mockIssueService.getById.mockResolvedValue({ ...staleInReviewIssue, executionRunId: "active-run" });
    mockIssueService.boardTakeover.mockRejectedValue(
      new HttpError(409, "Issue has an active execution run; use force release first"),
    );

    const app = createApp("board");
    const res = await request(app).post(`/api/issues/${ISSUE_ID}/board-takeover`).send();

    expect(res.status).toBe(409);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("normal checkout semantics unchanged — agents cannot checkout as a different agent id", async () => {
    const app = createApp("agent", AGENT_ID);
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/checkout`)
      .send({ agentId: OTHER_AGENT_ID, expectedStatuses: ["todo"] });

    // Route guard rejects cross-agent checkout at the route level (403)
    expect(res.status).toBe(403);
    expect(mockIssueService.checkout).not.toHaveBeenCalled();
  });
});
