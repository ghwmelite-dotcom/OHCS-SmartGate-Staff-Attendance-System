import { useState } from 'react';
import { getInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { resolvePhotoUrl } from '@/lib/api';

interface VisitorAvatarProps {
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-9 h-9 text-[12px]',
  md: 'w-10 h-10 text-[13px]',
  lg: 'w-14 h-14 text-lg',
};

export function VisitorAvatar({ firstName, lastName, photoUrl, size = 'md', className }: VisitorAvatarProps) {
  const resolved = resolvePhotoUrl(photoUrl);
  // On image load error, fall back to initials via React state — never innerHTML
  // (which would be an HTML-injection sink for visitor-supplied names).
  const [imgFailed, setImgFailed] = useState(false);

  if (resolved && !imgFailed) {
    return (
      <div className={cn('rounded-xl overflow-hidden shrink-0', sizeMap[size], className)}>
        <img
          src={resolved}
          alt={`${firstName} ${lastName}`}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0',
      sizeMap[size],
      className
    )}>
      {getInitials(firstName, lastName)}
    </div>
  );
}
