import * as React from "react";
import { Label } from "../atoms/label";
import { Input } from "../atoms/input";
import { PasswordInput } from "./password-input";

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, id, className, type, ...props }, ref) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {type === "password" ? (
        <PasswordInput ref={ref} id={id} className={className} {...props} />
      ) : (
        <Input ref={ref} id={id} type={type} className={className} {...props} />
      )}
    </div>
  ),
);
FormField.displayName = "FormField";
