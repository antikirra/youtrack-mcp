/**
 * Centralized YouTrack REST API field projections.
 *
 * Two tiers per entity:
 *   LIST   – minimal fields for collections (reduces token cost in search results)
 *   DETAIL – full fields for single-item reads (completeness for analysis)
 *
 * YouTrack REST API v3 notes:
 *   - Only id + $type are returned by default; every other field must be explicit
 *   - `priority`, `state`, `type`, `assignee` are NOT direct Issue fields — they live in `customFields`
 *   - customFields.value is polymorphic; requesting all sub-fields is safe (missing ones silently omitted)
 *   - Comment.attachments includes image files — use base64Content to retrieve inline
 *   - base64Content format: "data:[mimeType];base64,[data]"
 */

// ─── Custom field value projection ─────────────────────────────────────────
// Covers all concrete value types: StateBundleElement, EnumBundleElement,
// User, VersionBundleElement, BuildBundleElement, OwnedBundleElement, Period, etc.
const CF_VALUE =
  "id,$type,name,localizedName,isResolved,login,fullName," +
  "text,minutes,presentation,color(id,background,foreground)";

// ─── Issue ─────────────────────────────────────────────────────────────────
export const ISSUE_LIST =
  "id,idReadable,summary,resolved,created,updated," +
  "reporter(id,login,fullName)," +
  "project(id,shortName)," +
  `customFields(name,$type,value(${CF_VALUE}))`;

export const ISSUE_DETAIL =
  "id,idReadable,summary,description,usesMarkdown,created,updated,resolved," +
  "reporter(id,login,fullName),updater(id,login,fullName)," +
  "project(id,name,shortName),tags(id,name)," +
  "votes,commentsCount," +
  `customFields(id,name,$type,value(${CF_VALUE}))`;

// ─── Comment ───────────────────────────────────────────────────────────────
// attachments metadata included by default so AI can detect screenshot presence
// without fetching base64Content (which is expensive — use get_issue_images for that)
export const COMMENT =
  "id,text,created,updated,author(id,login,fullName),deleted," +
  "visibility(permittedGroups(id,name),permittedUsers(id,login,fullName))," +
  "reactions(id,reaction,author(id,login))," +
  "attachments(id,name,mimeType,size,thumbnailURL,removed)";

// ─── Activity ──────────────────────────────────────────────────────────────
// Uses /activities (flat array, supports $top/$skip).
// /activitiesPage uses cursor pagination — incompatible with offset-based $skip.
export const ACTIVITY =
  "id,$type,timestamp,author(id,login,fullName)," +
  "target(id,idReadable)," +
  "added(id,$type,name,localizedName,isResolved,login,fullName,text)," +
  "removed(id,$type,name,localizedName,isResolved,login,fullName,text)," +
  "category(id)";

// ─── Attachment ────────────────────────────────────────────────────────────
export const ATTACHMENT =
  "id,name,extension,created,updated,size,mimeType,url,thumbnailURL," +
  "author(id,login,fullName),draft,removed,comment(id)";

// Attachment with inline base64 content — used by get_issue_images
// base64Content format: "data:[mimeType];base64,[data]"
// NOTE: Only request for image mimeTypes; may be large for high-resolution screenshots
export const ATTACHMENT_WITH_CONTENT =
  "id,name,mimeType,size,thumbnailURL,base64Content,removed,comment(id,author(id,login,fullName),created)";

// ─── Issue links ───────────────────────────────────────────────────────────
export const LINK =
  "id,direction," +
  "linkType(id,name,localizedName,sourceToTarget,targetToSource,directed)," +
  "issues(id,idReadable,summary,customFields(name,value(name,localizedName,isResolved)))," +
  "trimmedIssues(id,idReadable,summary)";

// ─── Work items (time tracking) ────────────────────────────────────────────
export const WORK_ITEM =
  "id,created,updated,date," +
  "duration(minutes,presentation)," +
  "text,type(id,name)," +
  "author(id,login,fullName),creator(id,login,fullName)";

// ─── Project ───────────────────────────────────────────────────────────────
export const PROJECT_LIST =
  "id,name,shortName,archived,template";

export const PROJECT_DETAIL =
  "id,name,shortName,description,archived,template," +
  "leader(id,login,fullName)";

// ProjectCustomField wraps a CustomField — name/type/bundle live under field(...)
export const PROJECT_CUSTOM_FIELD =
  "id,ordinal,isPublic,canBeEmpty,emptyFieldText," +
  "field(id,name,localizedName,aliases,fieldType(id,presentation)," +
  "bundle(id,name,values(id,name,localizedName,description,isResolved,color(id,background,foreground))))";

// Full schema projection for inspect_project_schema — includes $type on bundle/field
// and archived flag on values, so AI understands what's active vs deprecated
export const PROJECT_SCHEMA_FIELD =
  "id,ordinal,isPublic,canBeEmpty,emptyFieldText," +
  "field(" +
  "  id,name,localizedName,$type,aliases," +
  "  fieldType(id,presentation)," +
  "  bundle(" +
  "    id,name,$type," +
  "    values(id,name,localizedName,description,isResolved,archived,ordinal," +
  "           color(id,background,foreground))" +
  "  )" +
  ")";

// ─── Report ────────────────────────────────────────────────────────────────
export const REPORT =
  "id,name,$type,pinned,own," +
  "owner(id,login,fullName)," +
  "projects(id,name,shortName)," +
  "readSharingSettings(type),updateSharingSettings(type)";

// ─── Agile boards ──────────────────────────────────────────────────────────
export const AGILE_LIST =
  "id,name,owner(id,login,fullName),projects(id,name,shortName)," +
  "currentSprint(id,name,start,finish)," +
  "readSharingSettings(type),updateSharingSettings(type)";

export const AGILE_DETAIL =
  "id,name,owner(id,login,fullName),projects(id,name,shortName)," +
  "currentSprint(id,name,start,finish,isDefault,archived)," +
  "sprints(id,name,start,finish,isDefault,archived)," +
  "columnSettings(columns(id,presentation))," +
  "swimlaneSettings(id,$type)," +
  "estimationField(id,name)," +
  "readSharingSettings(type),updateSharingSettings(type)";

// Full board structure for inspect_board_structure — includes column field value
// mappings, swimlane configuration, estimation/velocity fields, color coding
export const BOARD_STRUCTURE =
  "id,name,$type," +
  "owner(id,login,fullName)," +
  "projects(id,name,shortName)," +
  "currentSprint(id,name,start,finish,goal,isDefault,archived)," +
  "estimationField(id,name,localizedName,fieldType(id,presentation))," +
  "originalEstimationField(id,name)," +
  "velocityField(id,name)," +
  "sprintSyncField(id,name)," +
  "columnSettings(" +
  "  field(id,name,localizedName,fieldType(id,presentation))," +
  "  columns(id,presentation,isResolved,fieldValues(id,name,localizedName))" +
  ")," +
  "swimlaneSettings(" +
  "  id,$type,enabled," +
  "  field(id,name,localizedName,fieldType(id,presentation))," +
  "  values(id,name,localizedName)," +
  "  defaultCardType(id,name)" +
  ")," +
  "colorCoding(id,$type,field(id,name),prototype(id,name))," +
  "readSharingSettings(type),updateSharingSettings(type)";

// ─── Sprint ────────────────────────────────────────────────────────────────
// Issues intentionally excluded from sprint metadata — use get_sprint_issues
export const SPRINT =
  "id,name,goal,start,finish,isDefault,archived";

export const SPRINT_ISSUE =
  "id,idReadable,summary,resolved," +
  `customFields(name,value(name,localizedName,isResolved,login,fullName))`;

// ─── User ──────────────────────────────────────────────────────────────────
export const USER =
  "id,login,fullName,email,ringId,guest,online,banned,avatarUrl";

// ─── Tag ───────────────────────────────────────────────────────────────────
export const TAG =
  "id,name,color(id,background,foreground),owner(id,login,fullName)";

// ─── Saved query ───────────────────────────────────────────────────────────
export const SAVED_QUERY =
  "id,name,query,owner(id,login,fullName)," +
  "readSharingSettings(type),updateSharingSettings(type)";

// ─── Issue link type ───────────────────────────────────────────────────────
export const LINK_TYPE =
  "id,name,localizedName,sourceToTarget,targetToSource,directed,aggregation";

// ─── Global custom fields ──────────────────────────────────────────────────
// /api/admin/customFieldSettings/customFields — field catalog across all projects
export const GLOBAL_CUSTOM_FIELD =
  "id,name,localizedName,aliases,$type," +
  "fieldType(id,presentation)," +
  "isDisplayedInIssueList,isAutoAttached,isPublic";

// ─── Bundle values ─────────────────────────────────────────────────────────
// Used with /api/admin/customFieldSettings/bundles/{type}/{id}/values
// Supports: enum, state, version, ownedField, build
export const BUNDLE_VALUE =
  "id,name,localizedName,description," +
  "isResolved,archived,ordinal," +
  "color(id,background,foreground)";
