import { useId, useState } from 'react';
import { parseTags } from './media-utils.mjs';
import './tag-input.css';

export function TagInput({
  label,
  existingLabel,
  existingTags,
  value,
  onChange,
  name,
  placeholder = 'Separate tags with commas',
  disabled = false,
  required = false,
}: {
  label: string;
  existingLabel: string;
  existingTags: string[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const text = value ?? draft;
  const selected = new Set(parseTags(text));
  const catalog = [...new Set(existingTags)].sort();
  const available = catalog.filter((tag) => !selected.has(tag.toLowerCase()));
  function update(next: string) {
    setDraft(next);
    onChange?.(next);
  }
  return (
    <div className="tag-input">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        value={text}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        maxLength={1230}
        disabled={disabled}
        required={required}
      />
      {!disabled && (
        <select
          aria-label={existingLabel}
          value=""
          disabled={!available.length}
          onChange={(event) => {
            if (event.target.value)
              update([...parseTags(text), event.target.value].join(', '));
          }}
        >
          <option value="">
            {available.length
              ? 'Choose existing tag…'
              : catalog.length
                ? 'All existing tags selected'
                : 'No existing tags yet'}
          </option>
          {available.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
