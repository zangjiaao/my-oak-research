"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ContentItem } from "@/components/follow-content/context";

type BookmarkContextValue = {
  bookmarks: ContentItem[];
  toggleBookmark: (item: ContentItem) => void;
  isBookmarked: (id: string) => boolean;
};

const BookmarkContext = createContext<BookmarkContextValue | undefined>(
  undefined
);

const STORAGE_KEY = "oak-follow-content-bookmarks";

export const BookmarkProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [bookmarks, setBookmarks] = useState<ContentItem[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as ContentItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  }, [bookmarks]);

  const toggleBookmark = useCallback((item: ContentItem) => {
    setBookmarks((prev) => {
      const exists = prev.some((bookmark) => bookmark.id === item.id);
      if (exists) {
        return prev.filter((bookmark) => bookmark.id !== item.id);
      }
      return [...prev, item];
    });
  }, []);

  const isBookmarked = useCallback(
    (id: string) => bookmarks.some((bookmark) => bookmark.id === id),
    [bookmarks]
  );

  const value = useMemo(
    () => ({
      bookmarks,
      toggleBookmark,
      isBookmarked,
    }),
    [bookmarks, toggleBookmark, isBookmarked]
  );

  return (
    <BookmarkContext.Provider value={value}>
      {children}
    </BookmarkContext.Provider>
  );
};

export const useBookmarks = () => {
  const context = useContext(BookmarkContext);
  if (!context) {
    throw new Error("useBookmarks must be used within a BookmarkProvider");
  }
  return context;
};
