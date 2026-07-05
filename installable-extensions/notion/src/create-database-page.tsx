import { withAccessToken } from "@jingle/extension-utils";

import { CreatePageForm } from "./components/forms/CreatePageForm";
import { notionConnection } from "../domain/client";

const CreateDatabasePageCommand = withAccessToken(notionConnection)(CreatePageForm);

export default CreateDatabasePageCommand;
