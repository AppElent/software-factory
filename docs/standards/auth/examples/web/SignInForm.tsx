import { useSignIn } from "@clerk/react";
import { useState } from "react";
import { AuthButton } from "./AuthButton";
import { useAuthConfig } from "./AuthConfigProvider";
import { AuthError } from "./AuthError";
import { AuthField } from "./AuthField";
import { TestLoginButton } from "./TestLoginButton";
import {
	clerkErrorMessage,
	orThrow,
	pickSecondFactor,
	type SecondFactorStrategy,
} from "./core";

type SecondFactorStep = {
	strategy: SecondFactorStrategy;
	safeIdentifier?: string;
};

function secondFactorPrompt({ strategy, safeIdentifier }: SecondFactorStep) {
	switch (strategy) {
		case "totp":
			return "Enter the code from your authenticator app.";
		case "backup_code":
			return "Enter one of your backup codes.";
		default:
			return `We sent a code to ${safeIdentifier ?? "your verified contact"}.`;
	}
}

type SignIn = ReturnType<typeof useSignIn>["signIn"];

function verifySecondFactor(
	signIn: SignIn,
	strategy: SecondFactorStrategy,
	code: string,
) {
	switch (strategy) {
		case "totp":
			return signIn.mfa.verifyTOTP({ code });
		case "backup_code":
			return signIn.mfa.verifyBackupCode({ code });
		case "phone_code":
			return signIn.mfa.verifyPhoneCode({ code });
		case "email_code":
			return signIn.mfa.verifyEmailCode({ code });
	}
}

export function SignInForm({ onSuccess }: { onSuccess: () => void }) {
	const { signIn } = useSignIn();
	const config = useAuthConfig();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [secondFactor, setSecondFactor] = useState<SecondFactorStep | null>(
		null,
	);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await orThrow(signIn.password({ identifier: email, password }));
			if (signIn.status === "complete") {
				await orThrow(signIn.finalize());
				onSuccess();
				return;
			}
			// Device trust (`needs_client_trust`) verifies a new device with the
			// same second-factor methods as MFA.
			if (
				signIn.status !== "needs_second_factor" &&
				signIn.status !== "needs_client_trust"
			) {
				setError("This account needs a sign-in step this form can't complete.");
				return;
			}
			const factor = pickSecondFactor(signIn.supportedSecondFactors);
			if (!factor) {
				setError("No supported verification method is set up for this account.");
				return;
			}
			if (factor.strategy === "phone_code") {
				await orThrow(signIn.mfa.sendPhoneCode());
			} else if (factor.strategy === "email_code") {
				await orThrow(signIn.mfa.sendEmailCode());
			}
			setCode("");
			setSecondFactor({
				strategy: factor.strategy,
				safeIdentifier:
					"safeIdentifier" in factor ? factor.safeIdentifier : undefined,
			});
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}

	async function handleVerify(e: React.FormEvent) {
		e.preventDefault();
		if (!secondFactor) {
			return;
		}
		setError(null);
		setLoading(true);
		try {
			await orThrow(verifySecondFactor(signIn, secondFactor.strategy, code));
			if (signIn.status === "complete") {
				await orThrow(signIn.finalize());
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

	if (secondFactor) {
		return (
			<form onSubmit={handleVerify} noValidate className="flex flex-col gap-3">
				<AuthError message={error} />
				<p className="text-sm text-[var(--auth-muted)]">
					{secondFactorPrompt(secondFactor)}
				</p>
				<AuthField
					label={
						secondFactor.strategy === "backup_code"
							? "Backup code"
							: "Verification code"
					}
					type="text"
					autoComplete="one-time-code"
					value={code}
					onChange={setCode}
					required
				/>
				<AuthButton loading={loading}>Verify</AuthButton>
				<button
					type="button"
					onClick={() => {
						setSecondFactor(null);
						setError(null);
					}}
					className="text-xs text-[var(--auth-muted)] hover:underline"
				>
					Back to sign in
				</button>
			</form>
		);
	}

	return (
		<form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
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
				autoComplete="current-password"
				value={password}
				onChange={setPassword}
				required
			/>
			<AuthButton loading={loading}>Sign in</AuthButton>
			<TestLoginButton onSuccess={onSuccess} />
			<div className="mt-1 flex justify-between text-xs text-[var(--auth-muted)]">
				{config.features.forgotPassword ? (
					<a href={config.paths.forgotPassword} className="hover:underline">
						Forgot password?
					</a>
				) : (
					<span />
				)}
				<a href={config.paths.signUp} className="hover:underline">
					Create an account
				</a>
			</div>
		</form>
	);
}
