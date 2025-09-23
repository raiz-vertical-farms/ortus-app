import { useState, useCallback, useRef, useEffect, useMemo } from "react";

// Generic type for the form state
type FormState<T> = T;

function getKeyMap<T>(obj: T): { [K in keyof T]: K } {
  const keyMap: any = {};
  // @ts-ignore
  for (const key of Object.keys(obj)) {
    keyMap[key] = key;
  }
  return keyMap as { [K in keyof T]: K };
}

export function useForm<T>(initialState: T) {
  const formRef = useRef<HTMLFormElement | null>(null);

  const stateDep = JSON.stringify(initialState);

  const [form, setForm] = useState<FormState<T>>(initialState);

  const keys = useMemo(() => getKeyMap(initialState), [stateDep]);

  useEffect(() => {
    if (JSON.stringify(form) !== stateDep) {
      setForm(initialState);
    }
  }, [stateDep]);

  const handleReset = useCallback(() => {
    setForm(initialState);
  }, [stateDep]);

  const handleChange = useCallback(
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) => {
      const { name, value } = event.target;
      setForm((form) => ({
        ...form,
        [name]: value,
      }));
    },
    []
  );

  const handleSubmit = useCallback(
    (callback: (form: T) => void) => {
      const isValid = formRef.current?.checkValidity();

      if (isValid) {
        callback(form);
      } else {
        formRef.current?.reportValidity();
      }
    },
    [form]
  );

  const handleFormSubmit = useCallback(
    (callback: (form: T) => void) =>
      (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const isValid = event.currentTarget.checkValidity();
        if (isValid) {
          return callback(form);
        } else {
          event.currentTarget.reportValidity();
        }
      },
    [form]
  );

  const isDirty = useMemo(() => JSON.stringify(form) !== stateDep, [form]);

  return {
    form,
    setForm,
    formRef,
    handleSubmit,
    handleChange,
    handleFormSubmit,
    handleReset,
    keys,
    isDirty,
  };
}

export default useForm;
