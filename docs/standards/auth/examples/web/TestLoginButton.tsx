import { useSignIn } from "@clerk/react";
import { useState } from "react";
import { AuthButton } from "./AuthButton";
import { AuthError } from "./AuthError";
import {
	CLERK_TEST_VERIFICATION_CODE,
	clerkErrorMessage,
	orThrow,
	shouldShowTestLogin,
} from "./core";

export function TestLoginButton({ onSuccess }: { onSuccess: () => void }) {
	const { signIn } = useSignIn();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	if (!shouldShowTestLogin(import.meta.env)) {
		return null;
	}

	async function loginTestUser() {
		setError(null);
		setLoading(true);
		try {
			// Clerk test emails sign in with a fixed code on development
			// instances, so no password is shipped in the bundle.
			await orThrow(
				signIn.create({
					identifier: import.meta.env.VITE_TEST_USER_EMAIL as string,
				}),
			);
			if (
				!signIn.supportedFirstFactors.some((f) => f.strategy === "email_code")
			) {
				setError("Enable email code sign-in for the test instance.");
				return;
			}
			await orThrow(signIn.emailCode.sendCode());
			await orThrow(
				signIn.emailCode.verifyCode({ code: CLERK_TEST_VERIFICATION_CODE }),
			);
			if (signIn.status === "complete") {
				await orThrow(signIn.finalize());
				onSuccess();
			} else {
				setError("Test user requires additional steps.");
			}
		} catch (err) {
			setError(clerkErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="mt-2 flex flex-col gap-1">
			<AuthButton
				type="button"
				variant="ghost"
				loading={loading}
				onClick={loginTestUser}
			>
				▶ Dev: log in as test user
			</AuthButton>
			<AuthError message={error} />
		</div>
	);
}
