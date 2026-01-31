const MOLTBOOK_BASE_URL = "https://www.moltbook.com/api/v1";

interface MoltbookResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
}

interface RegisterResponse {
  agent: {
    api_key: string;
    claim_url: string;
    verification_code: string;
  };
  important: string;
}

interface AgentProfile {
  name: string;
  description: string;
  karma: number;
  follower_count: number;
  following_count: number;
  is_claimed: boolean;
  is_active: boolean;
  created_at: string;
  last_active: string;
}

interface Post {
  id: string;
  submolt: string;
  title: string;
  content?: string;
  url?: string;
  author: {
    name: string;
    avatar?: string;
  };
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  is_pinned?: boolean;
}

interface Comment {
  id: string;
  content: string;
  author: {
    name: string;
    avatar?: string;
  };
  upvotes: number;
  created_at: string;
  replies?: Comment[];
}

interface Submolt {
  name: string;
  display_name: string;
  description: string;
  subscriber_count: number;
  post_count: number;
}

class MoltbookAPI {
  private apiKey: string | null = null;

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<MoltbookResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${MOLTBOOK_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          hint: data.hint,
        };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  // Register a new agent
  async register(name: string, description: string): Promise<MoltbookResponse<RegisterResponse>> {
    return this.request<RegisterResponse>("/agents/register", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  // Check agent status
  async getStatus(): Promise<MoltbookResponse<{ status: string }>> {
    return this.request("/agents/status");
  }

  // Get agent profile
  async getProfile(): Promise<MoltbookResponse<AgentProfile>> {
    return this.request("/agents/me");
  }

  // Get feed
  async getFeed(sort: "hot" | "new" | "top" = "hot", limit = 25): Promise<MoltbookResponse<Post[]>> {
    return this.request(`/feed?sort=${sort}&limit=${limit}`);
  }

  // Get posts
  async getPosts(
    sort: "hot" | "new" | "top" | "rising" = "hot",
    limit = 25,
    submolt?: string
  ): Promise<MoltbookResponse<Post[]>> {
    let url = `/posts?sort=${sort}&limit=${limit}`;
    if (submolt) url += `&submolt=${submolt}`;
    return this.request(url);
  }

  // Get single post
  async getPost(postId: string): Promise<MoltbookResponse<Post>> {
    return this.request(`/posts/${postId}`);
  }

  // Create post
  async createPost(
    submolt: string,
    title: string,
    content?: string,
    url?: string
  ): Promise<MoltbookResponse<Post>> {
    const body: any = { submolt, title };
    if (content) body.content = content;
    if (url) body.url = url;

    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Get comments on a post
  async getComments(postId: string, sort: "top" | "new" = "top"): Promise<MoltbookResponse<Comment[]>> {
    return this.request(`/posts/${postId}/comments?sort=${sort}`);
  }

  // Add comment
  async addComment(postId: string, content: string, parentId?: string): Promise<MoltbookResponse<Comment>> {
    const body: any = { content };
    if (parentId) body.parent_id = parentId;

    return this.request(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Upvote post
  async upvotePost(postId: string): Promise<MoltbookResponse<any>> {
    return this.request(`/posts/${postId}/upvote`, { method: "POST" });
  }

  // Downvote post
  async downvotePost(postId: string): Promise<MoltbookResponse<any>> {
    return this.request(`/posts/${postId}/downvote`, { method: "POST" });
  }

  // Upvote comment
  async upvoteComment(commentId: string): Promise<MoltbookResponse<any>> {
    return this.request(`/comments/${commentId}/upvote`, { method: "POST" });
  }

  // Get submolts
  async getSubmolts(): Promise<MoltbookResponse<Submolt[]>> {
    return this.request("/submolts");
  }

  // Search
  async search(query: string, limit = 25): Promise<MoltbookResponse<any>> {
    return this.request(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  // Follow agent
  async follow(agentName: string): Promise<MoltbookResponse<any>> {
    return this.request(`/agents/${agentName}/follow`, { method: "POST" });
  }

  // Unfollow agent
  async unfollow(agentName: string): Promise<MoltbookResponse<any>> {
    return this.request(`/agents/${agentName}/follow`, { method: "DELETE" });
  }
}

export const moltbookApi = new MoltbookAPI();
export type { Post, Comment, Submolt, AgentProfile, RegisterResponse };
