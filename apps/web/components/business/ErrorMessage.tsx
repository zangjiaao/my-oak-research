import React from "react";

const ErrorMessage = ({ children }: { children: React.ReactNode }) => {
  if (!children) return null;
  return <p className="text-destructive text-sm">{children}</p>;
};

export default ErrorMessage;
