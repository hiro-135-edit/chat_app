export type Room = {
  id: number;
  title: string;
  user_id: number;
  created_at: string;
  user: {
    id: number;
    name: string;
  };
};

export type RoomDetail = Room & {
  created_at_text: string;
};
