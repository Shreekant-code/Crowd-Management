"use client";

import { useEffect } from "react";
import { useToast } from "@/components/providers/toast-provider";

export function AuthFeedbackToast({ title, description, tone = "error" }) {
  const { pushToast } = useToast();

  useEffect(() => {
    if (!title) {
      return;
    }

    pushToast({
      title,
      description,
      tone,
    });
  }, [description, pushToast, title, tone]);

  return null;
}

