import { withAccessToken } from "@openwork/extension-utils";

import { CreatePageForm } from "./components/forms/CreatePageForm";
import { notionConnection } from "../domain/client";

export default withAccessToken(notionConnection)(CreatePageForm);
