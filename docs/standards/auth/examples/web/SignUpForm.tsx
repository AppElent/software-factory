import { useSignUp } from "@clerk/react";
import { useState } from "react";
import { AuthButton } from "./AuthButton";
import { useAuthConfig } from "./AuthConfigProvider";
import { AuthError } from "./AuthError";
import { AuthField } from "./AuthField";
import { clerkErrorMessage, orThrow } from "./core";

export function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
	const { signUp } = useSignUp();
	const config = useAuthConfig();
	const [step, setStep] = useState<"details" | "verify">("details");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function submitDetails(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await orThrow(signUp.password({ emailAddress: email, password }));
			await orThrow(signUp.verifications.sendEmailCode());
			setStep("verify");
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}

	async function submitCode(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await orThrow(signUp.verifications.verifyEmailCode({ code }));
			if (signUp.status === "complete") {
				await orThrow(signUp.finalize());
				onSuccess();
			} else {
				setError("Invalid or incomplete verification.");
			}
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}

	if (step === "verify") {
		return (
			<form onSubmit={submitCode} noValidate className="flex flex-col gap-3">
				<AuthError message={error} />
				<p className="text-sm text-[var(--auth-muted)]">
					We sent a code to {email}.
				</p>
				<AuthField
					label="Verification code"
					type="text"
					autoComplete="one-time-code"
					value={code}
					onChange={setCode}
					required
				/>
				<AuthButton loading={loading}>Verify</AuthButton>
			</form>
		);
	}

	return (
		<form onSubmit={submitDetails} noValidate className="flex flex-col gap-3">
			<AuthError message={error} />
			<AuthField
				label="Email"
				type="email"
				autoComplete="email"
				value={email}
				onChange={setEmail}
				required
			/>
			<AuthField
				label="Password"
				type="password"
				autoComplete="new-password"
				value={password}
				onChange={setPassword}
				required
			/>
			<AuthButton loading={loading}>Create account</AuthButton>
			<div className="mt-1 text-center text-xs text-[var(--auth-muted)]">
				<a href={config.paths.signIn} className="hover:underline">
					Already have an account? Sign in
				</a>
			</div>
		</form>
	);
}
