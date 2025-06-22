function filterValues<T extends Record<string, any>>(
  obj: T,
  predicate: (value: T[keyof T], key: keyof T) => boolean
): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (predicate(obj[key], key)) result[key] = obj[key];
  }
  return result;
}

export default filterValues;
