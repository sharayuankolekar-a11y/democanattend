import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield } from "lucide-react";

interface AdminPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AdminPasswordDialog = ({ open, onOpenChange }: AdminPasswordDialogProps) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Demo password - in production this would be server-side validated
    if (password === "admin123") {
      onOpenChange(false);
      setPassword("");
      setError(false);
      navigate("/admin");
    } else {
      setError(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <Shield className="text-primary" size={24} />
          </div>
          <DialogTitle className="text-center text-xl font-bold tracking-tight">Admin Access</DialogTitle>
          <DialogDescription className="text-center">
            Enter the admin password to continue.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <Input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            className={`h-12 rounded-xl ${error ? "border-destructive" : ""}`}
          />
          {error && (
            <p className="text-sm text-destructive">Incorrect password. Try again.</p>
          )}
          <Button type="submit" className="w-full" size="lg">
            Continue
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
