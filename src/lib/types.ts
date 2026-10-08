export type User = {
  id: string;
  username: string;
  email: string;
  is_admin: number;
};
export type VideoCard = {
  id: string;
  title: string;
  channel_id: string;
  channel: string;
  channel_slug?: string;
  duration: number;
  published_at: number | null;
  added_at: number;
  available: number;
  thumbnail: boolean;
  seconds: number;
  completed: number;
  reason?: string;
};
export type Video = VideoCard & {
  fps: number | null;
  description: string;
  imported_views: number;
  imported_likes: number;
  local_likes: number;
  liked: number;
  saved: number;
  subscribed: number;
};
export type Chapter = { start_time: number; end_time: number; title: string };
export type Subtitle = { language: string };
export type Comment = {
  id: string;
  parent_id: string | null;
  author: string;
  author_thumbnail?: string | null;
  text: string;
  source: string;
  created_at: number;
  likes: number;
  liked: number;
  replies: number;
};
