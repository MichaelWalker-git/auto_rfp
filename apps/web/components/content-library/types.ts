export interface ContentLibraryProps {
  orgId: string;
  kbId: string;
}

export interface DialogState {
  create: boolean;
  edit: boolean;
  view: boolean;
  delete: boolean;
}

export interface UrlState {
  search: string;
  category: string | null;
  status: string | null;
  page: number;
}