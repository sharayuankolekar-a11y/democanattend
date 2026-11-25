import React from "react";

interface CollegeLogoProps {
  size?: "sm" | "md" | "lg" | "xl" | "custom";
  className?: string;
  imageClassName?: string;
  alt?: string;
  showContainer?: boolean;
  containerClassName?: string;
}

export const CollegeLogo: React.FC<CollegeLogoProps> = ({
  size = "md",
  className = "",
  imageClassName = "",
  alt = "Canara Engineering College Logo",
  showContainer = false,
  containerClassName = "",
}) => {
  // Dimension presets
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-14 h-14",
    xl: "w-16 h-16",
    custom: "",
  };

  const selectedSize = sizeClasses[size];

  const imgElement = (
    <img
      src="/logo.jpeg"
      alt={alt}
      className={`object-contain max-w-full max-h-full rounded-lg ${selectedSize} ${imageClassName} ${className}`}
    />
  );

  if (showContainer) {
    return (
      <div
        className={`flex items-center justify-center bg-white rounded-xl p-1 shadow-sm border border-slate-200/80 overflow-hidden shrink-0 ${selectedSize} ${containerClassName}`}
      >
        {imgElement}
      </div>
    );
  }

  return imgElement;
};

export default CollegeLogo;
