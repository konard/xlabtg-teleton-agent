#!/bin/sh
set -u
cd /tmp/gh-issue-solver-1780101166480
R=REPORT.txt
{
echo "########## COMMIT_RESULT ##########"
cat COMMIT_RESULT.txt 2>/dev/null
echo "########## GIT LOG ##########"
git log --oneline -10
echo "########## GIT STATUS ##########"
git status --porcelain
echo "HEAD=$(git rev-parse HEAD)"
echo "ORIGIN=$(git rev-parse origin/issue-499-aa140238a8b8 2>/dev/null)"
echo "########## PR ##########"
gh pr view 513 --json isDraft,state,title,url --jq '"url="+.url+" state="+.state+" draft="+(.isDraft|tostring)+" title="+.title' 2>&1
echo "########## CI RUNS ##########"
gh run list --branch issue-499-aa140238a8b8 --limit 12 --json databaseId,name,status,conclusion,headSha,event --jq '.[] | .headSha[0:7]+" "+.event+" "+.name+" "+.status+" "+(.conclusion//"")' 2>&1
echo "########## END ##########"
} > $R 2>&1
