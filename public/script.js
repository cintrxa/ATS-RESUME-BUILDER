const optimizeBtn = document.getElementById("optimizeBtn");
const resumeInput = document.getElementById("resume");
const jobDescriptionInput = document.getElementById("jobDescription");
const output = document.getElementById("output");
const downloadBtn = document.getElementById("downloadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const planBadge = document.getElementById("planBadge");
const planActionButtons = document.querySelectorAll(".plan-action-btn");
const atsScore = document.getElementById("atsScore");
const atsProgressFill = document.getElementById("atsProgressFill");
const strengthsList = document.getElementById("strengthsList");
const weaknessesList = document.getElementById("weaknessesList");

async function updateNavbar() {
  try {
    const response = await fetch("/auth/me");

    const guestItems = document.querySelectorAll(".guest-only");
    const userItems = document.querySelectorAll(".user-only");

    if (!response.ok) {
      guestItems.forEach((el) => el.classList.remove("hidden"));
      userItems.forEach((el) => el.classList.add("hidden"));
      return;
    }

    const data = await response.json();

    guestItems.forEach((el) => el.classList.add("hidden"));
    userItems.forEach((el) => el.classList.remove("hidden"));

    if (planBadge && data.user) {
      const user = data.user;

      if (user.plan === "free") {
        const used = user.monthly_usage || 0;
        planBadge.innerText = `Free Plan • ${used}/2 used`;
      } else if (user.plan === "pro") {
        planBadge.innerText = "Pro Plan • Unlimited";
      } else if (user.plan === "premium") {
        planBadge.innerText = "Premium Plan • Unlimited";
      } else {
        planBadge.innerText = "Plan";
      }
    }
  } catch (err) {
    console.error(err);
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
      window.location.href = "index.html";
    } catch (err) {
      console.error(err);
    }
  });
}

if (planActionButtons.length > 0) {
  planActionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const plan = button.dataset.plan;

      try {
        const authCheck = await fetch("/auth/me");

        if (!authCheck.ok) {
          window.location.href = "login.html";
          return;
        }

        const response = await fetch("/api/change-plan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ plan })
        });

        const data = await response.json();

        if (!response.ok) {
          alert(data.error || "Could not update the plan.");
          return;
        }

        alert(`Your plan is now ${plan.toUpperCase()}.`);
        updateNavbar();
      } catch (err) {
        console.error(err);
      }
    });
  });
}

if (optimizeBtn) {
  optimizeBtn.addEventListener("click", async () => {

    const authCheck = await fetch("/auth/me");

    if (!authCheck.ok) {
      window.location.href = "login.html";
      return;
    }
    const resume = resumeInput.value.trim();
    const jobDescription = jobDescriptionInput.value.trim();

    if (!resume || !jobDescription) {
      output.innerText = "Please fill in both fields.";
      return;
    }

    optimizeBtn.disabled = true;
    optimizeBtn.innerText = "Optimizing...";
    output.innerText = "Analyzing your resume...";

    if (atsScore) {
      atsScore.innerText = "--/100";
    }

    if (atsProgressFill) {
      atsProgressFill.style.width = "0%";
    }

    if (strengthsList) {
      strengthsList.innerHTML = "";
    }

    if (weaknessesList) {
      weaknessesList.innerHTML = "";
    }

    try {
      const response = await fetch("/api/optimize-resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ resume, jobDescription })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "login.html";
          return;
        }

        if (response.status === 403) {
          alert(data.error || "Free plan limit reached.");
          window.location.href = "pricing.html";
          return;
        }

        output.innerText = data.error || "Something went wrong.";
        return;
      }

      output.innerText = data.optimizedResume;

      if (atsScore) {
        atsScore.innerText = `${data.score}/100`;
      }

      if (atsProgressFill) {
        const safeScore = Math.max(0, Math.min(100, Number(data.score) || 0));
        atsProgressFill.style.width = `${safeScore}%`;
      }

      if (strengthsList && Array.isArray(data.strengths)) {
        strengthsList.innerHTML = "";
        data.strengths.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          strengthsList.appendChild(li);
        });
      }

      if (weaknessesList && Array.isArray(data.weaknesses)) {
        weaknessesList.innerHTML = "";
        data.weaknesses.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          weaknessesList.appendChild(li);
        });
      }

      updateNavbar();
    } catch (err) {
      console.error(err);
      output.innerText = "Error connecting to the server.";
    }

    optimizeBtn.disabled = false;
    optimizeBtn.innerText = "Optimize Resume";
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener("click", async () => {
    const content = output.innerText;

    if (!content || content.includes("appear here")) {
      alert("Generate a resume first.");
      return;
    }

    try {
      const response = await fetch("/api/download-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      const blob = await response.blob();

      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = "optimized_resume.pdf";
      link.click();
    } catch (err) {
      console.error(err);
      alert("Error generating PDF.");
    }
  });
}

updateNavbar();