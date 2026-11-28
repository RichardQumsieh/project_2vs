import { Image } from "expo-image";
import React, { useState } from "react";
import { parseAvatarConfig, personInitials, type AvatarPerson } from "../../frontend/lib/avatar/config";
import { thumbnailDataUrl } from "../../frontend/lib/avatar/thumbnail";
import { Avatar } from "./ui";

export function PersonBadge({
  person,
  size,
  title,
}: {
  person?: AvatarPerson | null;
  size: number;
  title?: string;
}) {
  const config = parseAvatarConfig(person?.avatarConfig);
  const label = title || personInitials(person, "S");
  const [photoFailed, setPhotoFailed] = useState(false);
  if (config) {
    return (
      <Image
        accessibilityElementsHidden
        source={{ uri: thumbnailDataUrl(config) }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#F0ECF7" }}
      />
    );
  }
  if (person?.avatarUrl && !photoFailed) {
    return (
      <Image
        accessibilityElementsHidden
        source={{ uri: person.avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        onError={() => setPhotoFailed(true)}
      />
    );
  }
  return <Avatar title={label} size={size} />;
}
